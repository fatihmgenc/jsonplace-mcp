export function createHttpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

export function getHttpErrorStatus(error, fallbackStatus = 500) {
  return Number.isInteger(error?.status) ? error.status : fallbackStatus;
}
