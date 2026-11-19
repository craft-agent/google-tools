import { describe, expect, test } from "bun:test"
import { operationId, projectId, regionId, resourceName } from "./ids"

describe("projectId", () => {
  test.each(["my-proj", "abcde1", "a".repeat(30), "my-project-123"])("%s is a project id", (id) => {
    expect(projectId(id)).toBe(id)
  })

  test.each(["", "short", "My-Project", "1project", "my-project-", "a".repeat(31), "my_project", "a/b", "../x"])(
    "%p is refused",
    (id) => {
      expect(() => projectId(id)).toThrow(/is not a project id \(6 to 30 lowercase letters, digits and hyphens/)
    },
  )

  test("a project's resource name is told to be given as the id alone", () => {
    expect(() => projectId("projects/my-proj")).toThrow(/give the id alone/)
  })

  test("a long value is cut in the message", () => {
    expect(() => projectId("A".repeat(300))).toThrow(`${"A".repeat(100)}…`)
  })
})

describe("regionId", () => {
  test.each(["asia-northeast1", "us-central1", "me-central2", "northamerica-northeast1"])("%s is a region", (id) => {
    expect(regionId(id)).toBe(id)
  })

  test.each(["", "asia", "asia-northeast", "Asia-northeast1", "asia_northeast1", "locations/asia-northeast1", "us/1"])(
    "%p is refused",
    (id) => {
      expect(() => regionId(id)).toThrow(/is not a region/)
    },
  )
})

describe("resourceName", () => {
  test.each(["api", "a", "my-service-2", "api-00001-abc", "a".repeat(63)])("%s is a name", (name) => {
    expect(resourceName(name, "service name")).toBe(name)
  })

  test.each(["", "Api", "1api", "api-", "-api", "api_x", "a".repeat(64), "a b"])("%p is refused", (name) => {
    expect(() => resourceName(name, "service name")).toThrow(/is not a service name/)
  })

  test("a full resource name is told to be given as the short name", () => {
    expect(() => resourceName("projects/p/locations/r/services/api", "service name")).toThrow(
      /is a resource path, not a service name; give the short name alone/,
    )
  })
})

describe("operationId", () => {
  test.each(["operation-123", "a", "AbC_d-1", "a".repeat(128)])("%s is an operation id", (id) => {
    expect(operationId(id)).toBe(id)
  })

  test.each(["", "-a", "_a", "a/b", "a b", "a".repeat(129), "operations/x"])("%p is refused", (id) => {
    expect(() => operationId(id)).toThrow(/is not an operation id/)
  })
})
