import * as resources from 'resources';
import * as _ from 'lodash';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Core, Targets, Types } from '../../constants';
import { ListingItemMessage } from '../messages/ListingItemMessage';
import { ListingItemMessageCreateParams } from './MarketplaceMessageFactory';
import { ShippingAvailability } from '../enums/ShippingAvailability';
import { ImageVersions } from '../../core/helpers/ImageVersionEnumType';
import { MessageException } from '../exceptions/MessageException';
import {
    EscrowConfig, EscrowRatio,
    Item,
    ItemInfo,
    ItemObject,
    Location,
    MessagingInfo,
    MessagingOption,
    MPA,
    MPA_LISTING_ADD,
    PaymentInfo,
    PaymentInfoEscrow, PaymentOption, ShippingPrice
} from 'omp-lib/dist/interfaces/omp';
import { MPAction, SaleType } from 'omp-lib/dist/interfaces/omp-enums';
import { ItemCategoryFactory } from './ItemCategoryFactory';
import { ContentReference, DSN } from 'omp-lib/dist/interfaces/dsn';
import { ItemImageDataService } from '../services/ItemImageDataService';
import { NotImplementedException } from '../exceptions/NotImplementedException';
import { CryptoAddress } from 'omp-lib/dist/interfaces/crypto';
import { KVS } from 'omp-lib/dist/interfaces/common';

export class ListingItemMessageFactory {

    public log: LoggerType;

    constructor(
        @inject(Types.Factory) @named(Targets.Factory.ItemCategoryFactory) private itemCategoryFactory: ItemCategoryFactory,
        @inject(Types.Service) @named(Targets.Service.ItemImageDataService) public itemImageDataService: ItemImageDataService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    /**
     * Creates a ListingItemMessage from given parameters
     *
     * todo: supports only MPA_LISTING_ADD for now...
     * @param params
     * @returns {Promise<ListingItemMessage>}
     */
    public async get(params: ListingItemMessageCreateParams): Promise<MPA> {

        const information = await this.getMessageItemInfo(params.template.ItemInformation);
        const payment = await this.getMessagePayment(params.template.PaymentInformation);
        const messaging = await this.getMessageMessaging(params.template.MessagingInformation);
        const objects = await this.getMessageObjects(params.template.ListingItemObjects);

        const item = {
            information,
            payment,
            messaging,
            objects
        } as Item;

        return {
            type: MPAction.MPA_LISTING_ADD,
            item,
            hash: params.template.hash
        } as MPA_LISTING_ADD;
    }

    private async getMessageItemInfo(itemInformation: resources.ItemInformation): Promise<ItemInfo> {
        const category = await this.itemCategoryFactory.getArray(itemInformation.ItemCategory);
        const location = await this.getMessageItemInfoLocation(itemInformation.ItemLocation);
        const shippingDestinations = await this.getMessageItemInfoShippingDestinations(itemInformation.ShippingDestinations);
        const images = await this.getMessageInformationImages(itemInformation.ItemImages);

        return {
            title: itemInformation.title,
            shortDescription: itemInformation.shortDescription,
            longDescription: itemInformation.longDescription,
            category,
            location,
            shippingDestinations,
            images
        } as ItemInfo;
    }

    private async getMessageItemInfoLocation(itemLocation: resources.ItemLocation): Promise<Location> {
        const locationMarker: resources.LocationMarker = itemLocation.LocationMarker;
        const informationLocation: any = {};
        if (itemLocation.region) {
            informationLocation.country = itemLocation.region;
        }
        if (itemLocation.address) {
            informationLocation.address = itemLocation.address;
        }
        if (locationMarker) {
            informationLocation.gps = {
                lng: locationMarker.lng,
                lat: locationMarker.lat
            };

            if (locationMarker.markerTitle) {
                informationLocation.gps.marker_title = locationMarker.markerTitle;
            }
            if (locationMarker.markerText) {
                informationLocation.gps.marker_text = locationMarker.markerText;
            }
        }
        return informationLocation;
    }

    private async getMessageItemInfoShippingDestinations(shippingDestinations: resources.ShippingDestination[]): Promise<string[]> {
        const shippingDesArray: string[] = [];
        for (const destination of shippingDestinations) {
            switch (destination.shippingAvailability) {
                case ShippingAvailability.SHIPS:
                    shippingDesArray.push(destination.country);
                    break;
                case ShippingAvailability.DOES_NOT_SHIP:
                    shippingDesArray.push('-' + destination.country);
                    break;
            }
        }
        return shippingDesArray;
    }

    private async getMessageInformationImages(images: resources.ItemImage[]): Promise<ContentReference[]> {
        const contentReferences: ContentReference[] = [];

        for (const image of images) {
            const imageData = await this.getMessageItemInfoImageData(image.ItemImageDatas);
            contentReferences.push({
                hash: image.hash,
                data: imageData,
                featured: image.featured
            } as ContentReference);
        }
        return contentReferences;
    }

    private async getMessageItemInfoImageData(itemImageDatas: resources.ItemImageData[]): Promise<DSN[]> {
        const dsns: DSN[] = [];

        let selectedImageData = _.find(itemImageDatas, (imageData) => {
            return imageData.imageVersion === ImageVersions.RESIZED.propName;
        });

        if (!selectedImageData) {
            // if theres no resized version, then ORIGINAL can be used
            selectedImageData = _.find(itemImageDatas, (imageData) => {
                return imageData.imageVersion === ImageVersions.ORIGINAL.propName;
            });

            if (!selectedImageData) {
                // there's something wrong with the ItemImage if original image doesnt have data
                throw new MessageException('Original image data not found.');
            }
        }

        // load the actual image data
        const data = await this.itemImageDataService.loadImageFile(selectedImageData.imageHash, selectedImageData.imageVersion);
        dsns.push({
            protocol: selectedImageData.protocol,
            encoding: selectedImageData.encoding,
            data,
            id: selectedImageData.dataId
        } as DSN);

        return dsns;
    }


    private async getMessagePayment(paymentInformation: resources.PaymentInformation): Promise<PaymentInfo> {
        const escrow = await this.getMessageEscrow(paymentInformation.Escrow);
        const options = await this.getMessagePaymentOptions(paymentInformation.ItemPrice);
        switch (paymentInformation.type) {
            case SaleType.SALE:
                return {
                    type: paymentInformation.type,
                    escrow,
                    // TODO: missing support for optional price pegging
                    options
                } as PaymentInfoEscrow;

            case SaleType.AUCTION:
            case SaleType.FREE:
            case SaleType.RENT:
            case SaleType.WANTED:
            default:
                throw new NotImplementedException();
        }
    }

    private async getMessageEscrow(escrow: resources.Escrow): Promise<EscrowConfig> {
        return {
            type: escrow.type,
            ratio: {
                buyer: escrow.Ratio.buyer,
                seller: escrow.Ratio.seller
            } as EscrowRatio
        };
    }

    // todo: missing support for multiple payment currencies
    private async getMessagePaymentOptions(itemPrice: resources.ItemPrice): Promise<PaymentOption[]> {

        let address;

        // not using CryptocurrencyAddress in alpha
        if (!_.isEmpty(itemPrice.CryptocurrencyAddress)) {
            address = {
                type: itemPrice.CryptocurrencyAddress.type,
                address: itemPrice.CryptocurrencyAddress.address
            } as CryptoAddress;
        }

        return [{
            currency: itemPrice.currency,
            basePrice: itemPrice.basePrice,
            shippingPrice: {
                domestic: itemPrice.ShippingPrice.domestic,
                international: itemPrice.ShippingPrice.international
            } as ShippingPrice,
            address
        }];
    }

    private async getMessageMessaging(messagingInformations: resources.MessagingInformation[]): Promise<MessagingInfo> {

        const options: MessagingOption[] = [];
        for (const info of messagingInformations) {
            options.push({
                protocol: info.protocol,
                publicKey: info.publicKey
            } as MessagingOption);
        }

        const messagingInfo: MessagingInfo = {
            options
        };

        return messagingInfo;
    }

    private async getMessageObjects(listingItemObjects: resources.ListingItemObject[]): Promise<ItemObject[]> {
        const objectArray: ItemObject[] = [];
        for (const lio of listingItemObjects) {
            const objectValue = await this.getItemObject(lio);
            objectArray.push(objectValue);
        }
        return objectArray;
    }

    private async getItemObject(value: resources.ListingItemObject): Promise<ItemObject> {
        // check Table and Dropdown
        if (value.type === 'TABLE') {
            return {
                type: 'TABLE',
                description: value.description,
                table: await this.getObjectDataOptions(value.ListingItemObjectDatas)
            } as ItemObject;
        } else if (value.type === 'DROPDOWN') {
            return {
                type: 'DROPDOWN',
                description: value.description,
                objectId: value.objectId,
                forceInput: value.forceInput,
                options: await this.getObjectDataOptions(value.ListingItemObjectDatas)
            } as ItemObject;
        } else {
            throw new NotImplementedException();
        }
    }

    private async getObjectDataOptions(objectDatas: resources.ListingItemObjectData[]): Promise<KVS[]> {
        const objectDataArray: KVS[] = [];
        for (const objectValue of objectDatas) {
            objectDataArray.push({
                key: objectValue.key,
                value: objectValue.value
            } as KVS);
        }
        return objectDataArray;
    }

}
