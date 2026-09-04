import { createHmac } from "node:crypto";

export interface HmacConfig {
  /**
   * Preshared key which is used for signinatures.
   */
  readonly preSharedKey: string;
  /**
   * Signature algorithm.
   *
   * On recent releases of OpenSSL, `openssl list -digest-algorithms` will display the available digest algorithms.
   *
   * @default "SHA256"
   */
  readonly algorithm?: string;
}

export class HmacSigner {
  constructor(private readonly config: HmacConfig) {}

  /**
   * Signs provided value with HMAC signature.
   */
  readonly sign = (value: string): string => {
    return createHmac(
      this.config.algorithm ?? "SHA256",
      Buffer.from(this.config.preSharedKey, "hex"),
    )
      .update(value)
      .digest("hex");
  };

  /**
   * Verifies if the signature is one of provided value.
   */
  readonly isValidSignature = (props: {
    readonly value: string;
    readonly signature: string;
  }): boolean => {
    return this.sign(props.value) === props.signature;
  };
}
