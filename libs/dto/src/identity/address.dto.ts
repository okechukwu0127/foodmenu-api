import { Transform } from "class-transformer";
import {
  IsNumber,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AddressIdParamDto {
  @ApiProperty({
    example: "address-unique-1",
    maxLength: 128,
    description: "Stable client-generated ID; UUID format is not required",
  })
  @IsString()
  @Length(1, 128)
  id!: string;
}

export class PutCustomerAddressDto {
  @ApiProperty({ example: "Home", maxLength: 100 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  label!: string;

  @ApiProperty({
    example: "12 Example Street, Lagos, Nigeria",
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  address!: string;

  @ApiPropertyOptional({
    example: 6.5244,
    minimum: -90,
    maximum: 90,
    description: "Omitting this value clears the saved latitude",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    example: 3.3792,
    minimum: -180,
    maximum: 180,
    description: "Omitting this value clears the saved longitude",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class SetDefaultAddressDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: "address-unique-1",
    maxLength: 128,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @Length(1, 128)
  addressId!: string | null;
}

// Internal TCP contracts: customer ID is supplied by the gateway session, never by an HTTP body.
export class CustomerAddressesPayload {
  @IsString()
  @Length(1, 128)
  customerId!: string;
}

export class CustomerAddressKeyPayload extends CustomerAddressesPayload {
  @IsString()
  @Length(1, 128)
  addressId!: string;
}

export class PutCustomerAddressPayload extends PutCustomerAddressDto {
  @IsString()
  @Length(1, 128)
  customerId!: string;

  @IsString()
  @Length(1, 128)
  addressId!: string;
}

export class SetDefaultAddressPayload extends SetDefaultAddressDto {
  @IsString()
  @Length(1, 128)
  customerId!: string;
}

export class CustomerAddressResponseDto {
  @ApiProperty({ example: "address-unique-1" })
  id!: string;

  @ApiProperty({ example: "Home" })
  label!: string;

  @ApiProperty({ example: "12 Example Street, Lagos, Nigeria" })
  address!: string;

  @ApiPropertyOptional({ example: 6.5244 })
  latitude?: number;

  @ApiPropertyOptional({ example: 3.3792 })
  longitude?: number;
}

export class DefaultAddressResponseDto {
  @ApiProperty({ type: String, nullable: true, example: "address-unique-1" })
  defaultAddressId!: string | null;
}

export class CustomerAddressesResponseDto extends DefaultAddressResponseDto {
  @ApiProperty({ type: [CustomerAddressResponseDto] })
  addresses!: CustomerAddressResponseDto[];
}
