import { z } from "zod"
import { containerReply, containerSchema, containerView } from "./container-view"

/** The volume kinds Google's volume holds one of, as the keys that tell them and the kind they are shown as. */
const VOLUME_KINDS = [
  ["secret", "secret"],
  ["cloudSqlInstance", "cloud_sql"],
  ["gcs", "gcs"],
  ["nfs", "nfs"],
  ["emptyDir", "empty_dir"],
] as const

const EXECUTION_ENVIRONMENTS = {
  EXECUTION_ENVIRONMENT_GEN1: "gen1",
  EXECUTION_ENVIRONMENT_GEN2: "gen2",
} as const

/** What a service's revision template, a revision, and a job's task template have in common, as Google gives it. */
export const templateSettingsReply = z.object({
  serviceAccount: z.string().optional(),
  timeout: z.string().optional(),
  executionEnvironment: z.string().optional(),
  encryptionKey: z.string().optional(),
  vpcAccess: z.object({ connector: z.string().optional(), egress: z.string().optional() }).optional(),
  volumes: z
    .array(
      z.object({
        name: z.string().optional(),
        secret: z.unknown().optional(),
        cloudSqlInstance: z.unknown().optional(),
        gcs: z.unknown().optional(),
        nfs: z.unknown().optional(),
        emptyDir: z.unknown().optional(),
      }),
    )
    .optional(),
  containers: z.array(containerReply).optional(),
})

export const templateSettingsShape = {
  service_account: z.string().nullable(),
  timeout: z.string().nullable(),
  execution_environment: z.enum(EXECUTION_ENVIRONMENTS).nullable(),
  encryption_key: z.string().nullable(),
  vpc_access: z.object({ connector: z.string().nullable(), egress: z.string().nullable() }).nullable(),
  volumes: z.array(
    z.object({ name: z.string(), kind: z.enum(["secret", "cloud_sql", "gcs", "nfs", "empty_dir", "other"]) }),
  ),
  containers: z.array(containerSchema),
}

export type TemplateSettingsReply = z.infer<typeof templateSettingsReply>
export type TemplateSettings = z.infer<z.ZodObject<typeof templateSettingsShape>>

type VolumeReply = NonNullable<TemplateSettingsReply["volumes"]>[number]

function volumeKind(volume: VolumeReply): TemplateSettings["volumes"][number]["kind"] {
  const found = VOLUME_KINDS.find(([key]) => volume[key] !== undefined && volume[key] !== null)
  return found === undefined ? "other" : found[1]
}

/** The settings a revision template, a revision and a task template share; a volume as its name and kind only. */
export function templateSettings(reply: TemplateSettingsReply): TemplateSettings {
  const environment = reply.executionEnvironment
  return {
    service_account: reply.serviceAccount ?? null,
    timeout: reply.timeout ?? null,
    execution_environment:
      environment !== undefined && Object.hasOwn(EXECUTION_ENVIRONMENTS, environment)
        ? EXECUTION_ENVIRONMENTS[environment as keyof typeof EXECUTION_ENVIRONMENTS]
        : null,
    encryption_key: reply.encryptionKey ?? null,
    vpc_access:
      reply.vpcAccess === undefined
        ? null
        : { connector: reply.vpcAccess.connector ?? null, egress: reply.vpcAccess.egress ?? null },
    volumes: (reply.volumes ?? []).map((volume) => ({ name: volume.name ?? "", kind: volumeKind(volume) })),
    containers: (reply.containers ?? []).map(containerView),
  }
}
