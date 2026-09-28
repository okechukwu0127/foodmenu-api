export type ApiSuccessResponse<TData> = {
  success: true;
  status: "success";
  statusCode: number;
  message: string;
  data: TData;
  path?: string;
  timestamp: string;
};

type SuccessResponseOptions = {
  path?: string;
  statusCode?: number;
};

export const successResponse = <TData>(
  message: string,
  data: TData,
  options: SuccessResponseOptions = {},
): ApiSuccessResponse<TData> => ({
  data,
  message,
  path: options.path,
  status: "success",
  statusCode: options.statusCode ?? 200,
  success: true,
  timestamp: new Date().toISOString(),
});
