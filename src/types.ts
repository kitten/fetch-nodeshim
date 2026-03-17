type Or<T, U> = void extends T ? U : T;

interface _Headers extends Or<Headers, globalThis.Headers> {}

export type { _Headers as HeadersLike };
