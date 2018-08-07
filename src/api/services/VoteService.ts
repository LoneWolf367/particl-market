import * as Bookshelf from 'bookshelf';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { validate, request } from '../../core/api/Validate';
import { NotFoundException } from '../exceptions/NotFoundException';
import { VoteRepository } from '../repositories/VoteRepository';
import { Vote } from '../models/Vote';
import { VoteCreateRequest } from '../requests/VoteCreateRequest';
import { VoteUpdateRequest } from '../requests/VoteUpdateRequest';

export class VoteService {

    public log: LoggerType;

    constructor(
        @inject(Types.Repository) @named(Targets.Repository.VoteRepository) public voteRepo: VoteRepository,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    public async findAll(): Promise<Bookshelf.Collection<Vote>> {
        return this.voteRepo.findAll();
    }

    public async findOne(id: number, withRelated: boolean = true): Promise<Vote> {
        const vote = await this.voteRepo.findOne(id, withRelated);
        if (vote === null) {
            this.log.warn(`Vote with the id=${id} was not found!`);
            throw new NotFoundException(id);
        }
        return vote;
    }

    public async findOneByVoterAndProposal(voter: string, proposalId: number, withRelated: boolean = true): Promise<Vote> {
        const vote = await this.voteRepo.findOneByVoterAndProposal(voter, proposalId, withRelated);
        if (!vote) {
            this.log.warn(`Vote with the voter=${voter} and proposalId=${proposalId} was not found!`);
            throw new NotFoundException(voter);
        }
        return vote;
    }

    @validate()
    public async create( @request(VoteCreateRequest) data: VoteCreateRequest): Promise<Vote> {

        const body = JSON.parse(JSON.stringify(data));
        // this.log.debug('create Vote, body: ', JSON.stringify(body, null, 2));

        // TODO: extract and remove related models from request
        // const voteRelated = body.related;
        // delete body.related;

        // If the request body was valid we will create the vote
        const vote = await this.voteRepo.create(body);

        // TODO: create related models
        // voteRelated._id = vote.Id;
        // await this.voteRelatedService.create(voteRelated);

        // finally find and return the created vote
        const newVote = await this.findOne(vote.id);
        return newVote;
    }

    @validate()
    public async update(id: number, @request(VoteUpdateRequest) body: VoteUpdateRequest): Promise<Vote> {

        // find the existing one without related
        const vote = await this.findOne(id, false);

        if (!body.voter) {
            body.voter = vote.Voter;
        }
        if (!body.block) {
            body.block = vote.Block;
        }
        if (!body.weight) {
            body.weight = vote.Weight;
        }
        if (!body.proposal_option_id) {
            body.proposal_option_id = vote.toJSON().ProposalOption.id;
        }

        // update vote record
        const updatedVote = await this.voteRepo.update(id, body);

        return updatedVote;
    }

    public async destroy(id: number): Promise<void> {
        await this.voteRepo.destroy(id);
    }

}
