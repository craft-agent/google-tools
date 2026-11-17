import { z } from "zod"

/**
 * A container as Google gives it. An environment variable is read by its
 * `name` and `valueSource` alone: the schema holds no `value`, so a plain
 * value, which may be a credential, never gets past the parse.
 */
export const containerReply = z.object({
  name: z.string().optional(),
  image: z.string().optional(),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  workingDir: z.string().optional(),
  ports: z.array(z.object({ name: z.string().optional(), containerPort: z.number().optional() })).optional(),
  resources: z
    .object({
      limits: z.record(z.string(), z.string()).optional(),
      cpuIdle: z.boolean().optional(),
      startupCpuBoost: z.boolean().optional(),
    })
    .optional(),
  env: z
    .array(
      z.object({
        name: z.string().optional(),
        valueSource: z
          .object({
            secretKeyRef: z.object({ secret: z.string().optional(), version: z.string().optional() }).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  volumeMounts: z.array(z.object({ name: z.string().optional(), mountPath: z.string().optional() })).optional(),
})

/** An environment variable: its name and kind, a secret's reference, never a value. */
const envSchema = z.discriminatedUnion("kind", [
  z.object({ name: z.string(), kind: z.literal("value") }),
  z.object({ name: z.string(), kind: z.literal("secret"), secret: z.string(), version: z.string().nullable() }),
])

export const containerSchema = z.object({
  name: z.string().nullable(),
  image: z.string(),
  command: z.array(z.string()),
  args: z.array(z.string()),
  working_dir: z.string().nullable(),
  ports: z.array(z.object({ name: z.string().nullable(), container_port: z.number() })),
  resources: z.object({
    cpu: z.string().nullable(),
    memory: z.string().nullable(),
    cpu_idle: z.boolean().nullable(),
    startup_cpu_boost: z.boolean().nullable(),
  }),
  env: z.array(envSchema),
  volume_mounts: z.array(z.object({ name: z.string(), mount_path: z.string() })),
})

export type ContainerReply = z.infer<typeof containerReply>
export type ContainerView = z.infer<typeof containerSchema>

type EnvReply = NonNullable<ContainerReply["env"]>[number]

function envView({ name = "", valueSource }: EnvReply): z.infer<typeof envSchema> {
  const reference = valueSource?.secretKeyRef
  if (reference === undefined) return { name, kind: "value" }
  return { name, kind: "secret", secret: reference.secret ?? "", version: reference.version ?? null }
}

/** A container with each environment variable as its name and kind; nothing of a plain value. */
export function containerView(container: ContainerReply): ContainerView {
  const limits = container.resources?.limits
  return {
    name: container.name ?? null,
    image: container.image ?? "",
    command: container.command ?? [],
    args: container.args ?? [],
    working_dir: container.workingDir ?? null,
    ports: (container.ports ?? []).map((port) => ({
      name: port.name ?? null,
      container_port: port.containerPort ?? 0,
    })),
    resources: {
      cpu: limits?.cpu ?? null,
      memory: limits?.memory ?? null,
      cpu_idle: container.resources?.cpuIdle ?? null,
      startup_cpu_boost: container.resources?.startupCpuBoost ?? null,
    },
    env: (container.env ?? []).map(envView),
    volume_mounts: (container.volumeMounts ?? []).map((mount) => ({
      name: mount.name ?? "",
      mount_path: mount.mountPath ?? "",
    })),
  }
}
