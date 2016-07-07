import { FCTYPE } from "./Constants";
import { Model } from "./Model";
export declare class Packet {
    FCType: FCTYPE;
    nFrom: number;
    nTo: number;
    nArg1: number;
    nArg2: number;
    sPayload: number;
    sMessage: AnyMessage;
    private _aboutModel;
    private _pMessage;
    private _chatString;
    constructor(FCType: FCTYPE, nFrom: number, nTo: number, nArg1: number, nArg2: number, sPayload: number, sMessage: AnyMessage);
    aboutModel: Model;
    private _parseEmotes(msg);
    pMessage: string;
    chatString: string;
    toString(): string;
}
