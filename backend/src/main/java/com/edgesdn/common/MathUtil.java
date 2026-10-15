package com.edgesdn.common;

public final class MathUtil {

    private MathUtil() {
    }

    public static double clamp(double v, double lo, double hi) {
        if (Double.isNaN(v)) {
            return lo;
        }
        return Math.max(lo, Math.min(hi, v));
    }

    public static double clamp01(double v) {
        return clamp(v, 0.0, 1.0);
    }

    public static double sigmoid(double x) {
        return 1.0 / (1.0 + Math.exp(-x));
    }

    public static double round(double v, int digits) {
        double f = Math.pow(10, digits);
        return Math.round(v * f) / f;
    }

    public static double nz(Double v) {
        return v == null ? 0.0 : v;
    }

    public static String pct(Double v) {
        return v == null ? "n/a" : String.format("%.0f%%", v * 100.0);
    }
}
