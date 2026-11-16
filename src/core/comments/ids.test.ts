import { describe, expect, test } from "bun:test"
import { commentFileId, commentId } from "./ids"

const ID = "1MadeUpFileId_abcdefghij-0123456789"

describe("commentFileId", () => {
  test.each([
    ID,
    `https://docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com/spreadsheets/d/${ID}`,
    `https://docs.google.com/presentation/d/${ID}/edit#slide=id.p`,
    `https://docs.google.com/drawings/d/${ID}/edit?usp=sharing`,
    `https://docs.google.com/forms/d/${ID}/viewform`,
    `https://drive.google.com/file/d/${ID}/view`,
  ])("%s gives the id", (value) => {
    expect(commentFileId(value)).toBe(ID)
  })

  test.each([
    "",
    "root",
    "a/b",
    "..",
    "a b",
    "https://docs.google.com/document/d/",
    `https://docs.google.com/document/d/${ID}.x`,
  ])("%p is invalid_argument", (value) => {
    expect(() => commentFileId(value)).toThrow(expect.objectContaining({ code: "invalid_argument" }))
  })

  test("the id of a URL is no root", () => {
    expect(() => commentFileId("https://docs.google.com/document/d/root")).toThrow(
      expect.objectContaining({ code: "invalid_argument" }),
    )
  })
})

describe("commentId", () => {
  test.each(["AAAAbcdEfgh", "a_b-c.d:e", "a".repeat(200), "1", "a.b"])("%p is a comment id", (value) => {
    expect(commentId(value, "comment id")).toBe(value)
  })

  test.each(["", ".", "..", "a..b", "a/b", "a b", "a?b", "a".repeat(201)])(
    "%p is invalid_argument, naming what it is not",
    (value) => {
      expect(() => commentId(value, "reply id")).toThrow(
        expect.objectContaining({ code: "invalid_argument", message: expect.stringContaining("is not a reply id.") }),
      )
    },
  )
})
