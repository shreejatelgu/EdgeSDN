package com.edgesdn.common;

import com.edgesdn.routing.FlowSpec;
import com.edgesdn.routing.MeterSpec;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.List;

/** Thin wrapper around the Spring-configured ObjectMapper for JSON stored in text columns. */
@Component
public class JsonCodec {

    public static final TypeReference<List<FlowSpec>> FLOW_LIST = new TypeReference<>() {
    };
    public static final TypeReference<List<MeterSpec>> METER_LIST = new TypeReference<>() {
    };
    public static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };

    private final ObjectMapper mapper;

    public JsonCodec(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public ObjectMapper mapper() {
        return mapper;
    }

    public String write(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON serialisation failed: " + e.getMessage(), e);
        }
    }

    public <T> T read(String json, Class<T> type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON parse failed: " + e.getMessage(), e);
        }
    }

    public <T> T read(String json, TypeReference<T> type) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON parse failed: " + e.getMessage(), e);
        }
    }

    public <T> List<T> readList(String json, TypeReference<List<T>> type) {
        List<T> list = read(json, type);
        return list == null ? List.of() : list;
    }

    public JsonNode tree(String json) {
        try {
            return mapper.readTree(json == null ? "{}" : json);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("JSON parse failed: " + e.getMessage(), e);
        }
    }

    public static String truncate(String s, int max) {
        if (s == null || s.length() <= max) {
            return s;
        }
        return s.substring(0, Math.max(0, max - 15)) + "...[truncated]";
    }
}
