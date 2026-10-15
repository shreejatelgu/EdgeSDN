package com.edgesdn.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

@Configuration
@EnableScheduling
@EnableAsync
@EnableConfigurationProperties(EdgeProperties.class)
public class AppConfig {

    /**
     * Single-threaded executor for the recommendation pipeline: the digital twin can only run
     * one simulation at a time, so pipelines are serialised.
     */
    @Bean(name = "pipelineExecutor")
    public ThreadPoolTaskExecutor pipelineExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(20);
        executor.setThreadNamePrefix("pipeline-");
        executor.initialize();
        return executor;
    }

    @Bean
    public RestClient agentRestClient(EdgeProperties props) {
        EdgeProperties.Agent a = props.getAgent();
        return RestClient.builder()
                .requestFactory(requestFactory(a.getConnectTimeoutMs(), a.getReadTimeoutMs()))
                .baseUrl(a.getBaseUrl())
                .defaultHeader("X-Edge-Token", a.getToken())
                .build();
    }

    @Bean
    public RestClient odlRestClient(EdgeProperties props) {
        EdgeProperties.Odl o = props.getOdl();
        String basic = Base64.getEncoder()
                .encodeToString((o.getUsername() + ":" + o.getPassword()).getBytes(StandardCharsets.UTF_8));
        return RestClient.builder()
                .requestFactory(requestFactory(o.getTimeoutMs(), o.getTimeoutMs()))
                .defaultHeader("Authorization", "Basic " + basic)
                .defaultHeader("Accept", "application/json")
                .build();
    }

    @Bean
    public RestClient mlRestClient(EdgeProperties props) {
        EdgeProperties.Ml m = props.getMl();
        RestClient.Builder builder = RestClient.builder()
                .requestFactory(requestFactory(m.getTimeoutMs(), m.getTimeoutMs()))
                .baseUrl(m.getBaseUrl());
        if (m.getApiKey() != null && !m.getApiKey().isBlank()) {
            builder.defaultHeader("X-Api-Key", m.getApiKey());
        }
        return builder.build();
    }

    private static ClientHttpRequestFactory requestFactory(int connectMs, int readMs) {
        // HTTP/1.1 explicitly: the JDK client would otherwise try an h2c upgrade on plain http.
        HttpClient http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(connectMs))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofMillis(readMs));
        return factory;
    }
}
