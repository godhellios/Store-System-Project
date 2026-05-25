declare module "qz-tray" {
  const qz: {
    websocket: {
      connect(options?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
      isActive(): boolean;
    };
    security: {
      setCertificatePromise(fn: (resolve: (cert: string) => void) => void): void;
      setSignatureAlgorithm(alg: string): void;
      setSignaturePromise(fn: (toSign: string) => (resolve: () => void) => void): void;
    };
    configs: {
      create(
        printer: string | undefined,
        options?: {
          size?: { width: number; height: number };
          units?: string;
          margins?: number | { top: number; right: number; bottom: number; left: number };
          orientation?: "portrait" | "landscape";
          scaleContent?: boolean;
          rasterize?: boolean;
        }
      ): unknown;
    };
    print(config: unknown, data: Array<{ type: string; format: string; data: string }>): Promise<void>;
  };
  export default qz;
}
