declare module "libraw-wasm" {
  export interface LibRawSettings {
    bright?: number;
    threshold?: number;
    autoBrightThr?: number;
    adjustMaximumThr?: number;
    expShift?: number;
    expPreser?: number;
    halfSize?: boolean;
    fourColorRgb?: boolean;
    highlight?: number;
    useAutoWb?: boolean;
    useCameraWb?: boolean;
    useCameraMatrix?: number;
    outputColor?: number;
    outputBps?: number;
    outputTiff?: boolean;
    outputFlags?: number;
    userFlip?: number;
    userQual?: number;
    userBlack?: number;
    userCblack?: ReadonlyArray<number>;
    userSat?: number;
    medPasses?: number;
    noAutoBright?: boolean;
    useFujiRotate?: number;
    greenMatching?: boolean;
    dcbIterations?: number;
    dcbEnhanceFl?: boolean;
    fbddNoiserd?: number;
    expCorrec?: boolean;
    noAutoScale?: boolean;
    noInterpolation?: boolean;
    greybox?: ReadonlyArray<number> | null;
    cropbox?: ReadonlyArray<number> | null;
    aber?: ReadonlyArray<number> | null;
    gamm?: ReadonlyArray<number> | null;
    userMul?: ReadonlyArray<number> | null;
    outputProfile?: string | null;
    cameraProfile?: string | null;
    badPixels?: string | null;
    darkFrame?: string | null;
  }

  export interface LibRawMetadata {
    width?: number;
    height?: number;
    bits?: number;
    colors?: number;
    raw_width?: number;
    raw_height?: number;
    raw_bps?: number;
    camera_make?: string;
    camera_model?: string;
    iso_speed?: number;
    shutter?: number;
    aperture?: number;
    focal_len?: number;
    timestamp?: Date;
    desc?: string;
    [key: string]: unknown;
  }

  export interface LibRawProcessedImage {
    width: number;
    height: number;
    bits: number;
    colors: number;
    data: Uint8Array | Uint16Array;
  }

  export type LibRawImageData =
    | Uint8Array
    | Uint16Array
    | LibRawProcessedImage;

  export default class LibRaw {
    constructor();
    open(bytes: Uint8Array, settings?: LibRawSettings): Promise<unknown>;
    metadata(fullOutput?: boolean): Promise<LibRawMetadata>;
    imageData(): Promise<LibRawImageData>;
  }
}
