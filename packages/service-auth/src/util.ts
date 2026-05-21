import { randomInt } from "node:crypto";

const numbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export function generateOTP(length: number = 6) {
  const otp: number[] = [];
  for (let i = 0; i < length; i++) {
    otp.push(numbers[randomInt(numbers.length)] ?? 0);
  }
  return otp.join("");
}

export function printError(error: unknown) {
  console.error(error instanceof Error ? error.message : error);
}
