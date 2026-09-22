class HttpError extends Error {
  constructor(message, statusCode = 500, code = "HTTP_ERROR") {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function asyncHandler(fn) {
  return (request, response, next) => {
    Promise.resolve(fn(request, response, next)).catch(next);
  };
}

function sendError(response, error, fallbackMessage = "Unexpected error.") {
  const statusCode = error?.statusCode || error?.status || 500;
  const message = error?.message || fallbackMessage;
  response.status(statusCode).json({ error: message });
}

function globalErrorHandler(error, _request, response, _next) {
  sendError(response, error);
}

module.exports = {
  HttpError,
  asyncHandler,
  sendError,
  globalErrorHandler,
};
