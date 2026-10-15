package com.edgesdn.common;

/** Namespace for the small set of application exceptions mapped to HTTP status codes. */
public final class Exceptions {

    private Exceptions() {
    }

    /** 404 */
    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) {
            super(message);
        }
    }

    /** 409 - the request conflicts with the current state (e.g. approving a non-pending recommendation). */
    public static class ConflictException extends RuntimeException {
        public ConflictException(String message) {
            super(message);
        }
    }

    /** 400 */
    public static class BadRequestException extends RuntimeException {
        public BadRequestException(String message) {
            super(message);
        }
    }

    /** 502 - the twin-agent, OpenDaylight or the ML service failed or is unreachable. */
    public static class ExternalServiceException extends RuntimeException {
        public ExternalServiceException(String message) {
            super(message);
        }

        public ExternalServiceException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
