import { Config, Effect, Layer, References, Tracer } from "effect";
import { OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { ServerConfig } from "../../config.ts";
import { ServerLoggerLive } from "../../serverLogger.ts";
import { makeLocalFileTracer } from "../LocalFileTracer.ts";
import { BrowserTraceCollector } from "../Services/BrowserTraceCollector.ts";
import { makeTraceSink } from "../TraceSink.ts";

const otlpSerializationLayer = OtlpSerialization.layerJson;
const ObservabilityPrivacyConfig = Config.all({
  localTracingEnabled: Config.boolean("T3CODE_LOCAL_TRACING_ENABLED").pipe(
    Config.withDefault(false),
  ),
  otlpExportAllowed: Config.boolean("T3CODE_ALLOW_OTLP_EXPORTS").pipe(Config.withDefault(false)),
});

const NativeTracerLayer = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span: (spanOptions) => new Tracer.NativeSpan(spanOptions),
  }),
);

export const ObservabilityLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const privacy = yield* ObservabilityPrivacyConfig.asEffect();
    const otlpTracesUrl = privacy.otlpExportAllowed ? config.otlpTracesUrl : undefined;
    const otlpMetricsUrl = privacy.otlpExportAllowed ? config.otlpMetricsUrl : undefined;

    const traceReferencesLayer = Layer.mergeAll(
      Layer.succeed(Tracer.MinimumTraceLevel, config.traceMinLevel),
      Layer.succeed(References.TracerTimingEnabled, config.traceTimingEnabled),
    );

    const tracerLayer = Layer.unwrap(
      Effect.gen(function* () {
        const delegate =
          otlpTracesUrl === undefined
            ? undefined
            : yield* OtlpTracer.make({
                url: otlpTracesUrl,
                exportInterval: `${config.otlpExportIntervalMs} millis`,
                resource: {
                  serviceName: config.otlpServiceName,
                  attributes: {
                    "service.runtime": "t3-server",
                    "service.mode": config.mode,
                  },
                },
              });

        if (!privacy.localTracingEnabled) {
          return Layer.mergeAll(
            delegate ? Layer.succeed(Tracer.Tracer, delegate) : NativeTracerLayer,
            Layer.succeed(BrowserTraceCollector, {
              record: () => Effect.void,
            }),
          );
        }

        const sink = yield* makeTraceSink({
          filePath: config.serverTracePath,
          maxBytes: config.traceMaxBytes,
          maxFiles: config.traceMaxFiles,
          batchWindowMs: config.traceBatchWindowMs,
        });
        const tracer = yield* makeLocalFileTracer({
          filePath: config.serverTracePath,
          maxBytes: config.traceMaxBytes,
          maxFiles: config.traceMaxFiles,
          batchWindowMs: config.traceBatchWindowMs,
          sink,
          ...(delegate ? { delegate } : {}),
        });

        return Layer.mergeAll(
          Layer.succeed(Tracer.Tracer, tracer),
          Layer.succeed(BrowserTraceCollector, {
            record: (records) =>
              Effect.sync(() => {
                for (const record of records) {
                  sink.push(record);
                }
              }),
          }),
        );
      }),
    ).pipe(Layer.provideMerge(otlpSerializationLayer));

    const metricsLayer =
      otlpMetricsUrl === undefined
        ? Layer.empty
        : OtlpMetrics.layer({
            url: otlpMetricsUrl,
            exportInterval: `${config.otlpExportIntervalMs} millis`,
            resource: {
              serviceName: config.otlpServiceName,
              attributes: {
                "service.runtime": "t3-server",
                "service.mode": config.mode,
              },
            },
          }).pipe(Layer.provideMerge(otlpSerializationLayer));

    return Layer.mergeAll(ServerLoggerLive, traceReferencesLayer, tracerLayer, metricsLayer);
  }),
);
