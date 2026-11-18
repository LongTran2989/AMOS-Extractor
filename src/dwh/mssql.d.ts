// Minimal types for the parts of the `mssql` package the DWH runner uses. The package ships no
// types and the plan allows no new dependencies (so no @types/mssql).
declare module "mssql" {
  namespace sql {
    interface config {
      server: string;
      user?: string;
      password?: string;
      database?: string;
      port?: number;
      connectionTimeout?: number;
      requestTimeout?: number;
      stream?: boolean;
      arrayRowMode?: boolean;
      pool?: { max?: number; min?: number; idleTimeoutMillis?: number };
      options?: {
        trustServerCertificate?: boolean;
        encrypt?: boolean;
        readOnlyIntent?: boolean;
        appName?: string;
        useUTC?: boolean;
        instanceName?: string;
      };
    }
    interface ISqlType {
      type: unknown;
      length?: number;
    }
    interface IColumnMetadata {
      index: number;
      name: string;
      length?: number;
      type?: unknown;
    }
    interface IResult {
      recordset?: unknown[];
      recordsets?: unknown[][];
      columns?: IColumnMetadata[][];
      rowsAffected: number[];
    }
    class Request {
      stream: boolean;
      arrayRowMode: boolean;
      input(name: string, type: ISqlType | (() => ISqlType), value: unknown): Request;
      query(command: string): Promise<IResult>;
      query(command: string, callback: (err?: Error, result?: IResult) => void): Request;
      cancel(): boolean;
      pause(): boolean;
      resume(): boolean;
      on(event: string, listener: (...args: any[]) => void): this;
    }
    class ConnectionPool {
      constructor(config: config);
      connect(): Promise<ConnectionPool>;
      close(): Promise<void>;
      request(conf?: { requestTimeout?: number }): Request;
    }
    function NVarChar(length?: number): ISqlType;
    const MAX: number;
  }
  export default sql;
}
