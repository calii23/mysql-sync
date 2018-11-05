import Chalk from 'chalk';
import {PathLike, readFile, stat, Stats, writeFile} from 'fs';
import {Schema, validate as validateScheme} from 'jsonschema';
import {mkdir} from 'mkdir-recursive';
import {parse, relative, resolve as resolvePath} from 'path';
import {get as getStackTrace} from 'stack-trace';
import {promisify} from 'util';

// extend native types

declare global {
    type ReplaceValueFunction = (match: string, index: number, fullString: string) => string;

    interface Array<T> {
        last: T | null;

        pushAll(this: T[], items: T[]): number;

        flatMap<U>(this: T[], callback: (value: T, index: number, array: T[]) => U | U[]): U[];
    }

    interface String {
        replace(this: string, searchValue: string | RegExp, replaceValue: string | ReplaceValueFunction): string;

        replaceAll(this: string, searchValue: string | RegExp, replaceValue: string | ReplaceValueFunction): string;
    }
}

Object.defineProperty(Array.prototype, 'last', {
    get<T>(this: T[]): T | null {
        if (this.length === 0) {
            return null;
        }
        return this[this.length - 1];
    },
    enumerable: false,
    configurable: false
});

Object.defineProperty(Array.prototype, 'pushAll', {
    value<T>(this: T[], items: T[]): number {
        return Array.prototype.push.apply(this, items);
    },
    enumerable: false,
    configurable: false,
    writable: false
});

Object.defineProperty(Array.prototype, 'flatMap', {
    value<T, U>(this: T[], callback: (value: T, index: number, array: T[]) => U | U[]): U[] {
        let flatArray: U[] = [];
        for (let i = 0; i < this.length; i++) {
            let currentResult = callback(this[i], i, this);
            if (Array.isArray(currentResult)) {
                flatArray.pushAll(currentResult);
            } else {
                flatArray.push(currentResult);
            }
        }
        return flatArray;
    },
    enumerable: false,
    configurable: false,
    writable: false
});

Object.defineProperty(String.prototype, 'replaceAll', {
    value(this: string, searchValue: string | RegExp, replaceValue: string | ReplaceValueFunction): string {
        let last: string;
        let current = this;
        do {
            last = current;
            current = current.replace(searchValue, replaceValue);
        } while (last !== current);
        return current;
    },
    enumerable: false,
    configurable: false,
    writable: false
});

// json files

export async function readJsonFile<RESULT>(file: string, scheme?: Schema, defaultValue?: RESULT): Promise<RESULT> {
    if (!(await asyncExistsFile(file))) {
        if (defaultValue) {
            console.trace(`file '${file}' does not exists, so create new with default value`);
            await writeJsonFile(file, defaultValue);
        } else {
            throw new Error(`file not found: ${file}`);
        }
    }
    let fileContent: Buffer;
    try {
        fileContent = await asyncReadFile(file);
    } catch (error) {
        throw new Error(`Could not read file "${file}": ${error.message}`);
    }
    let entity: RESULT;
    try {
        entity = JSON.parse(fileContent.toString());
    } catch (error) {
        throw new Error(`Could not read JSON file "${file}": ${error.message}`);
    }
    if (scheme && !validateJson(entity, scheme, file)) {
        throw new Error(`Invalid JSON content in file "${file}"`);
    }
    return entity;
}

export async function writeJsonFile(file: string, entity: any): Promise<void> {
    let json = JSON.stringify(entity);
    try {
        await asyncWriteFile(file, json);
    } catch (error) {
        throw new Error(`Could not write file "${file}": ${error.message}`);
    }
}

export function validateJson(entity: any, scheme: Schema, source?: string): boolean {
    let configValidationResult = validateScheme(entity, scheme);
    if (!configValidationResult.valid) {
        configValidationResult.errors.forEach(error =>
            console.error(`Invalid property "${error.property}" in "${source || 'entity'}": ${error.message}`));
        return false;
    }
    return true;
}

// logging

const originalLog = console.log;
const originalError = console.error;

export function setupLogger(loggingLevel: LoggingLevel) {
    let level = getLevel(loggingLevel);
    let trace = loggingLevel === 'trace';

    console.trace = level >= 4 ? createLogger(Chalk.cyan('TRACE'), trace, 'stdout') : voidFunction;
    console.debug = level >= 3 ? createLogger(Chalk.green('DEBUG'), trace, 'stdout') : voidFunction;
    console.info = level >= 2 ? createLogger(Chalk.blue(' INFO'), trace, 'stdout') : voidFunction;
    console.warn = level >= 1 ? createLogger(Chalk.yellowBright(' WARN'), trace, 'stderr') : voidFunction;
    console.error = level >= 0 ? createLogger(Chalk.red('ERROR'), trace, 'stderr') : voidFunction;

    console.log('setup logger with level:', loggingLevel);
}

function getLevel(loggingLevel: LoggingLevel): number {
    switch (loggingLevel) {
        case 'error':
            return 0;
        case 'warn':
            return 1;
        case 'info':
            return 2;
        case 'debug':
            return 3;
        case 'trace':
            return 4;
    }
}

function createLogger(loggerName: string, trace: boolean, output: 'stdout' | 'stderr'): (message: string, ...optionalParams: any[]) => void {
    return (message, ...optionalParams) => {
        let now = new Date();
        let year = pad(now.getFullYear().toString(), '0', 4);
        let month = pad((now.getMonth() + 1).toString(), '0', 2);
        let day = pad(now.getDate().toString(), '0', 2);
        let hour = pad(now.getHours().toString(), '0', 2);
        let minute = pad(now.getMinutes().toString(), '0', 2);
        let second = pad(now.getSeconds().toString(), '0', 2);
        let millisecond = pad(now.getMilliseconds().toString(), '0', 3);
        let loggerMessage: string;
        let dateString = Chalk.yellow(`${year}-${month}-${day} ${hour}:${minute}:${second}.${millisecond}`);
        if (trace) {
            let stackTrace = getStackTrace();
            let stack = stackTrace[1];
            let file = relative(process.cwd(), stack.getFileName());
            let line = stack.getLineNumber().toString();
            let fileString = Chalk.gray(`(${file}:${line})`);
            loggerMessage = `${dateString} ${fileString} ${loggerName}: ${message}`;
        } else {
            loggerMessage = `${dateString} ${loggerName}: ${message}`;
        }
        if (!trace) {
            for (let param of optionalParams) {
                if (param.hasOwnProperty('stack')) {
                    delete param.stack;
                }
            }
        }
        switch (output) {
            case 'stdout':
                originalLog.apply(null, [loggerMessage].concat(optionalParams));
                break;
            case 'stderr':
                originalError.apply(null, [loggerMessage].concat(optionalParams));
                break;
        }
    };
}

export type LoggingLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export const asyncStat: (path: PathLike) => Promise<Stats> = promisify(stat);

export const asyncReadFile: (path: PathLike) => Promise<Buffer> = promisify(readFile);

export const asyncWriteFile: (path: PathLike, data: any) => Promise<void> = promisify(writeFile);

export const asyncMkdir: (root: string, mode?: number) => Promise<void> = promisify(mkdir);

export function asyncExistsFile(path: PathLike): Promise<boolean> {
    return new Promise<boolean>(resolve =>
        asyncStat(path)
            .then(stats => resolve(stats.isFile()))
            .catch(() => resolve(false)));
}

export function asyncExistsDir(path: PathLike): Promise<boolean> {
    return new Promise<boolean>(resolve =>
        asyncStat(path)
            .then(stats => resolve(stats.isDirectory()))
            .catch(() => resolve(false)));
}

// utils

const voidFunction = () => {
    // do nothing
};

export function pathRelativeToFile(path: string, file: string): string {
    file = resolvePath(file);
    let fileData = parse(file);
    return relative(fileData.dir, path);
}

export function pad(input: string, fill: string, minLength: number) {
    while (input.length < minLength) {
        input = fill + input;
    }
    return input;
}

export function sleep(millis: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, millis));
}

export function parseSqlDate(sqlDate: string): Date {
    return new Date(`${sqlDate} ${getLocalTimezone()}`);
}

export function getLocalTimezone(): string {
    let offset = new Date().getTimezoneOffset();
    let minutes = -offset;
    let hours = Math.floor(minutes / 60);
    minutes -= hours * 60;
    return `UTC+${hours}:${pad(minutes.toString(), '0', 2)}`;
}
