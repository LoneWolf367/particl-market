// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as _ from 'lodash';
import * as resources from 'resources';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { ListingItemCreateRequest } from '../requests/ListingItemCreateRequest';
import { ListingItemMessage } from '../messages/ListingItemMessage';
import { ItemCategoryFactory } from './ItemCategoryFactory';
import { ShippingAvailability } from '../enums/ShippingAvailability';
import { ItemInformationCreateRequest } from '../requests/ItemInformationCreateRequest';
import { LocationMarkerCreateRequest } from '../requests/LocationMarkerCreateRequest';
import { ItemImageCreateRequest } from '../requests/ItemImageCreateRequest';
import { ItemImageDataCreateRequest } from '../requests/ItemImageDataCreateRequest';
import { ImageVersions } from '../../core/helpers/ImageVersionEnumType';
import { PaymentInformationCreateRequest } from '../requests/PaymentInformationCreateRequest';
import { EscrowCreateRequest } from '../requests/EscrowCreateRequest';
import { EscrowRatioCreateRequest } from '../requests/EscrowRatioCreateRequest';
import { ItemPriceCreateRequest } from '../requests/ItemPriceCreateRequest';
import { ShippingPriceCreateRequest } from '../requests/ShippingPriceCreateRequest';
import { CryptocurrencyAddressCreateRequest } from '../requests/CryptocurrencyAddressCreateRequest';
import { MessagingInformationCreateRequest } from '../requests/MessagingInformationCreateRequest';
import { ListingItemObjectCreateRequest } from '../requests/ListingItemObjectCreateRequest';
import { ListingItemObjectDataCreateRequest } from '../requests/ListingItemObjectDataCreateRequest';
import { MessagingProtocolType } from '../enums/MessagingProtocolType';
import { ItemLocationCreateRequest } from '../requests/ItemLocationCreateRequest';
import { MessageException } from '../exceptions/MessageException';
import { ItemImageDataService } from '../services/ItemImageDataService';

export class ListingItemFactory {

    public log: LoggerType;

    constructor(
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType,
        @inject(Types.Factory) @named(Targets.Factory.ItemCategoryFactory) private itemCategoryFactory: ItemCategoryFactory,
        @inject(Types.Service) @named(Targets.Service.ItemImageDataService) public itemImageDataService: ItemImageDataService
    ) {
        this.log = new Logger(__filename);
    }

    /**
     * Creates a ListingItemMessage from given data
     *
     * @param {module:resources.ListingItemTemplate} listingItemTemplate
     * @param {string} proposalHash
     * @param {number} expiryTime
     * @returns {Promise<ListingItemMessage>}
     */
    public async getMessage(listingItemTemplate: resources.ListingItemTemplate): Promise<ListingItemMessage> {

        const information = await this.getMessageInformation(listingItemTemplate.ItemInformation);
        const payment = await this.getMessagePayment(listingItemTemplate.PaymentInformation);
        const messaging = await this.getMessageMessaging(listingItemTemplate.MessagingInformation);
        const objects = await this.getMessageObjects(listingItemTemplate.ListingItemObjects);

        const message = {
            hash: listingItemTemplate.hash,
            information,
            payment,
            messaging,
            objects
        } as ListingItemMessage;

        return message;
    }

    /**
     *
     * @param {ListingItemMessage} listingItemMessage
     * @param {module:resources.SmsgMessage} smsgMessage
     * @param {number} marketId
     * @param {module:resources.ItemCategory} rootCategory
     * @returns {Promise<ListingItemCreateRequest>}
     */
    public async getModel(listingItemMessage: ListingItemMessage, smsgMessage: resources.SmsgMessage, marketId: number,
                          rootCategory: resources.ItemCategory): Promise<ListingItemCreateRequest> {

        const itemInformation = await this.getModelItemInformation(listingItemMessage.information, rootCategory);
        const paymentInformation = await this.getModelPaymentInformation(listingItemMessage.payment);
        const messagingInformation = await this.getModelMessagingInformation(listingItemMessage.messaging);
        const listingItemObjects = await this.getModelListingItemObjects(listingItemMessage.objects);

        return {
            hash: listingItemMessage.hash,
            seller: smsgMessage.from,
            market_id: marketId,
            expiryTime: smsgMessage.daysretention,
            postedAt: smsgMessage.sent,
            expiredAt: smsgMessage.expiration,
            receivedAt: smsgMessage.received,
            itemInformation,
            paymentInformation,
            messagingInformation,
            listingItemObjects
        } as ListingItemCreateRequest;
    }

    // ---------------
    // MODEL
    // ---------------
    private async getModelListingItemObjects(objects: any[]): Promise<ListingItemObjectCreateRequest[]> {
        const objectArray: ListingItemObjectCreateRequest[] = [];
        for (const object of objects) {
            let objectData;
            if ('TABLE' === object.type) {
                objectData = await this.getModelObjectDataForTypeTable(object['table']);
            } else if ('DROPDOWN' === object.type) {
                objectData = await this.getModelObjectDataForTypeDropDown(object['options']);
            }
            objectArray.push({
                type: object.type,
                description: object.title,
                listingItemObjectDatas: objectData
            } as ListingItemObjectCreateRequest);
        }
        return objectArray;
    }

    private async getModelObjectDataForTypeTable(objectDatas: any): Promise<ListingItemObjectDataCreateRequest[]> {
        const objectDataArray: ListingItemObjectDataCreateRequest[] = [];
        for (const objectData of objectDatas) {
            objectDataArray.push({
                key: objectData.key,
                value: objectData.value
            } as ListingItemObjectDataCreateRequest);
        }
        return objectDataArray;
    }

    private async getModelObjectDataForTypeDropDown(objectDatas: any): Promise<ListingItemObjectDataCreateRequest[]> {
        const objectDataArray: ListingItemObjectDataCreateRequest[] = [];
        for (const objectData of objectDatas) {
            objectDataArray.push({
                key: objectData.name,
                value: objectData.value
            } as ListingItemObjectDataCreateRequest);
        }
        return objectDataArray;
    }

    private async getModelMessagingInformation(messaging: any): Promise<MessagingInformationCreateRequest[]> {
        const messagingArray: MessagingInformationCreateRequest[] = [];
        for (const messagingData of messaging) {
            messagingArray.push({
                protocol: MessagingProtocolType[messagingData.protocol],
                publicKey: messagingData.public_key
            } as MessagingInformationCreateRequest);
        }
        return messagingArray;
    }

    private async getModelPaymentInformation(payment: any): Promise<PaymentInformationCreateRequest> {
        const escrow = await this.getModelEscrow(payment.escrow);
        const itemPrice = await this.getModelItemPrice(payment.cryptocurrency);

        return {
            type: payment.type,
            escrow,
            itemPrice
        } as PaymentInformationCreateRequest;
    }

    private async getModelItemPrice(cryptocurrency: any): Promise<ItemPriceCreateRequest> {
        const shippingPrice = await this.getModelShippingPrice(cryptocurrency[0].shipping_price);
        let cryptocurrencyAddress;
        if (!_.isEmpty(cryptocurrency[0].address)) {
            cryptocurrencyAddress = await this.getModelCryptocurrencyAddress(cryptocurrency[0].address);
        }
        return {
            currency: cryptocurrency[0].currency,
            basePrice: cryptocurrency[0].base_price,
            shippingPrice,
            cryptocurrencyAddress
        } as ItemPriceCreateRequest;
    }

    private async getModelShippingPrice(shippingPrice: any): Promise<ShippingPriceCreateRequest> {
        return {
            domestic: shippingPrice.domestic,
            international: shippingPrice.international
        } as ShippingPriceCreateRequest;
    }

    private async getModelCryptocurrencyAddress(cryptocurrencyAddress: any): Promise<CryptocurrencyAddressCreateRequest> {
        return {
            type: cryptocurrencyAddress.type,
            address: cryptocurrencyAddress.address
        } as CryptocurrencyAddressCreateRequest;
    }

    private async getModelEscrow(escrow: any): Promise<EscrowCreateRequest> {
        const ratio = await this.getModelEscrowRatio(escrow.ratio);
        return {
            type: escrow.type,
            ratio
        } as EscrowCreateRequest;
    }

    private async getModelEscrowRatio(ratio: any): Promise<EscrowRatioCreateRequest> {
        return {
            buyer: ratio.buyer,
            seller: ratio.seller
        } as EscrowRatioCreateRequest;
    }

    private async getModelItemInformation(information: any, rootCategory: resources.ItemCategory): Promise<ItemInformationCreateRequest> {
        const itemCategory = await this.itemCategoryFactory.getModel(information.category, rootCategory);
        const itemLocation = await this.getModelLocation(information.location);
        const shippingDestinations = await this.getModelShippingDestinations(information.shipping_destinations);
        const itemImages = await this.getModelImages(information.images);

        return {
            title: information.title,
            shortDescription: information.short_description,
            longDescription: information.long_description,
            itemCategory,
            itemLocation,
            shippingDestinations,
            itemImages
        } as ItemInformationCreateRequest;
    }

    private async getModelLocation(location: any): Promise<ItemLocationCreateRequest> {
        const locationObject: any = {};
        const region = location.country;
        const address = location.address;

        if (region) {
            locationObject.region = region;
        }
        if (address) {
            locationObject.address = address;
        }

        if (location.gps) {
            const locationMarker = await this.getModelLocationMarker(location.gps);
            locationObject.locationMarker = locationMarker;

        }

        return locationObject;
    }

    private async getModelLocationMarker(gps: any): Promise<LocationMarkerCreateRequest> {
        const lat: number = gps.lat;
        const lng: number = gps.lng;
        const locationMarker = {
            lat,
            lng
        } as LocationMarkerCreateRequest;

        if (gps.marker_title) {
            locationMarker.markerTitle = gps.marker_title;
        }
        if (gps.marker_text) {
            locationMarker.markerText = gps.marker_text;
        }
        return locationMarker;
    }

    private async getModelShippingDestinations(shippingDestinations: string[]): Promise<resources.ShippingDestination[]> {

        const destinations: resources.ShippingDestination[] = [];
        for (const destination of shippingDestinations) {

            let shippingAvailability = ShippingAvailability.SHIPS;
            let country = destination;

            if (destination.charAt(0) === '-') {
                shippingAvailability = ShippingAvailability.DOES_NOT_SHIP;
                country = destination.substring(1);
            }

            destinations.push({
                country,
                shippingAvailability
            } as resources.ShippingDestination);
        }

        return destinations;
    }

    private async getModelImages(images: any[]): Promise<ItemImageCreateRequest[]> {

        const imageCreateRequests: ItemImageCreateRequest[] = [];
        for (const image of images) {
            const datas = await this.getModelImageDatas(image.data);
            imageCreateRequests.push({
                hash: image.hash,
                datas
            } as ItemImageCreateRequest);
        }
        return imageCreateRequests;
    }

    private async getModelImageDatas(imageDatas: any[]): Promise<ItemImageDataCreateRequest[]> {

        const imageDataCreateRequests: ItemImageDataCreateRequest[] = [];
        for (const imageData of imageDatas) {
            imageDataCreateRequests.push({
                dataId: imageData.id,
                protocol: imageData.protocol,
                imageVersion: ImageVersions.ORIGINAL.propName,
                encoding: imageData.encoding,
                data: imageData.data
            } as ItemImageDataCreateRequest);
        }
        return imageDataCreateRequests;
    }



}
