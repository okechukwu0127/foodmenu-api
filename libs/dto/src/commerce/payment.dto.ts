import { IsUUID, IsString, Length, IsOptional } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
export class QuotePaymentDto {
  @ApiProperty({ description: "Server-issued checkout quote UUID" })
  @IsUUID()
  quoteId!: string;
}
export class QuotePaymentPayload extends QuotePaymentDto {
  @IsOptional()
  @IsUUID()
  conversationId?: string;
  @IsString()
  @Length(1, 128)
  customerId!: string;
}
