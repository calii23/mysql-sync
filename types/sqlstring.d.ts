type SqlType = boolean | number | Date | Buffer | string | { toSqlString(): any } | null;
type SqlTypes = SqlType | SqlType[] | SqlEntity;
type SqlEntity = Record<string, SqlType>;

declare module 'sqlstring' {
    function escapeId(val: string | string[], forbidQualified?: boolean): string;

    function escape(val: SqlTypes, stringifyObjects?: boolean, timeZone?: string): string;

    function arrayToList(array: SqlType, timeZone?: string): string;

    function format(sql: string, values?: SqlTypes[], stringifyObjects?: boolean, timeZone?: boolean): string;

    function dateToString(date: number | string | Date, timeZone?: string): string;

    function bufferToString(buffer: Buffer): string;

    function objectToValues(object: SqlEntity, timeZone?: string): string;

    function raw(sql: string): { toSqlString(): string };
}
