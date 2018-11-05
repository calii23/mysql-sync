declare module 'mkdir-recursive' {
    function mkdir(root: string, callback: (err: Error | null) => void): void;
    function mkdir(root: string, mode: number, callback: (err: Error | null) => void): void;

    function mkdirSync(root: string): Error | void;
    function mkdirSync(root: string, mode: number): Error | void;

    function rmdir(root: string, callback: (err: Error | null) => void): void;

    function rmdirSync(root: string): Error | void;
}
