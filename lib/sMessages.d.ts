export declare type AnyMessage = FCTypeLoginResponse | FCTypeSlaveVShareResponse | FCTypeTagsResponse | FCTokenIncResponse | RoomDataMessage | Message;
export declare type FCTypeLoginResponse = string;
export declare type FCTypeSlaveVShareResponse = number[];
export interface FCTypeTagsResponse {
    [index: number]: string[];
}
export interface FCTokenIncResponse {
    ch: number;
    flags: number;
    m: [number, number, string];
    sesstype: number;
    stamp: number;
    tokens: number;
    u: [number, number, string];
}
export interface RoomDataMessage {
    countdown: boolean;
    model: number;
    sofar: number;
    src: string;
    topic: string;
    total: number;
}
export interface BaseMessage {
    sid: number;
    uid: number;
    lv?: number;
    nm?: string;
    vs?: number;
    msg?: string;
}
export interface Message extends BaseMessage {
    u?: UserDetailsMessage;
    m?: ModelDetailsMessage;
    s?: SessionDetailsMessage;
}
export interface ModelDetailsMessage {
    camscore?: number;
    continent?: string;
    flags?: number;
    kbit?: number;
    lastnews?: number;
    mg?: number;
    missmfc?: number;
    new_model?: number;
    rank?: number;
    rc?: number;
    topic?: string;
    hidecs?: boolean;
}
export interface UserDetailsMessage {
    age?: number;
    avatar?: number;
    blurb?: string;
    camserv?: number;
    chat_bg?: number;
    chat_color?: string;
    chat_font?: number;
    chat_opt?: number;
    city?: string;
    country?: string;
    creation?: number;
    ethnic?: string;
    occupation?: string;
    photos?: number;
    profile?: number;
}
export interface SessionDetailsMessage {
    ga2?: string;
    gst?: string;
    ip?: string;
    rp?: number;
    tk?: number;
}
