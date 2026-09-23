import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class PaymentStatusParamDto {
  @ApiProperty({ example: "pi_123" })
  @IsString()
  paymentIntentId!: string;
}
