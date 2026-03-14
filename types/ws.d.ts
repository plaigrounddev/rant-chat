/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "ws" {
    import { EventEmitter } from "events";

    namespace WebSocket {
        type Data = string | Buffer | ArrayBuffer | Buffer[];
    }

    class WebSocket extends EventEmitter {
        constructor(address: string, options?: Record<string, any>);

        readonly readyState: number;

        static readonly CONNECTING: 0;
        static readonly OPEN: 1;
        static readonly CLOSING: 2;
        static readonly CLOSED: 3;

        close(code?: number, reason?: string): void;
        send(data: any, cb?: (err?: Error) => void): void;
        send(data: any, options: Record<string, any>, cb?: (err?: Error) => void): void;
        terminate(): void;

        on(event: "open", listener: () => void): this;
        on(event: "close", listener: (code: number, reason: string) => void): this;
        on(event: "error", listener: (err: Error) => void): this;
        on(event: "message", listener: (data: WebSocket.Data) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
    }

    export = WebSocket;
}
