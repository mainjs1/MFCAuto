import { AnyMessage } from "./sMessages";
import { FCTYPE } from "./Constants";
import { Model } from "./Model";
export declare class Packet {
    readonly FCType: FCTYPE;
    readonly nFrom: number;
    readonly nTo: number;
    readonly nArg1: number;
    readonly nArg2: number;
    readonly sPayload: number;
    readonly sMessage: AnyMessage | undefined;
    private _aboutModel;
    private _pMessage;
    private _chatString;
    constructor(FCType: FCTYPE, nFrom: number, nTo: number, nArg1: number, nArg2: number, sPayload: number, sMessage: AnyMessage | undefined);
    readonly aboutModel: Model | undefined;
    private _parseEmotes(msg);
    readonly pMessage: string | undefined;
    readonly chatString: string;
    toString(): string;
}
