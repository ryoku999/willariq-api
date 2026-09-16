export interface ResponseFormat<T> {
  success: boolean;
  path: string;
  data: T;
}
