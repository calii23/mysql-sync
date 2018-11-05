export interface DatabaseConnection<OPTIONS = any> {
    readonly connected: boolean;

    connect(options: OPTIONS): Promise<boolean>;

    disconnect(): Promise<void>;

    query<ROW = SqlEntity>(sql: string, ...values: SqlTypes[]): Promise<ROW[]>;

    testConnection(): Promise<boolean>;
}
