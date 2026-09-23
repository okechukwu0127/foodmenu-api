export type ApiSuccessResponse<TData> = {
  success: true;
  message: string;
  data: TData;
};

export const successResponse = <TData>(
  message: string,
  data: TData,
): ApiSuccessResponse<TData> => ({
  data,
  message,
  success: true,
});
