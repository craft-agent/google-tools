import { describe, expect, test } from "bun:test"
import { htmlToText } from "./html-text"

describe("htmlToText", () => {
  test("drops script and style blocks with their content, in any case and with attributes", () => {
    expect(htmlToText('a<STYLE type="text/css">p{x:y}</STYLE>b<script src="x.js">var a = "<p>";</script>c')).toBe("abc")
  })

  test("a block with no closing tag is left as it is, and does not hide the text after another that closes", () => {
    expect(htmlToText("a<script>never closed b<style>p{}</style>c")).toBe("anever closed bc")
  })

  test("a break, the end of a paragraph, a division or a row ends a line", () => {
    expect(htmlToText("a<br>b<br/>c<BR class='x'>d</p>e</div>f</tr>g")).toBe("a\nb\nc\nd\ne\nf\ng")
  })

  test("other tags go and their text stays, a tag with attributes included", () => {
    expect(htmlToText('<a href="https://example.test/?a=1&amp;b=2">link</a> <b>bold</b>')).toBe("link bold")
  })

  test("runs of three or more line ends are folded to a blank line, and the ends are trimmed", () => {
    expect(htmlToText("\n\n<p>a</p><p></p><p></p><p>b</p>\n\n")).toBe("a\n\nb")
  })

  test("decodes the common named references and the numeric ones", () => {
    expect(
      htmlToText("&amp; &lt; &gt; &quot; &#39; &apos; a&nbsp;b &mdash; &hellip; &copy; &#8364; &#x1F600; &#X41;"),
    ).toBe("& < > \" ' ' a b — … © € 😀 A")
  })

  test("decodes once: an encoded reference stays a reference, and an encoded tag stays text", () => {
    expect(htmlToText("&amp;lt;b&amp;gt; &lt;b&gt;x&lt;/b&gt;")).toBe("&lt;b&gt; <b>x</b>")
  })

  test("leaves an unknown name or a broken reference as it is and replaces an impossible code point", () => {
    expect(htmlToText("&nosuch; &amp &#; &#0; &#xD800; &#1114112;")).toBe("&nosuch; &amp &#; \uFFFD \uFFFD \uFFFD")
  })

  test("a mail of many unclosed tags is read in linear time", () => {
    const start = performance.now()

    htmlToText("<script>".repeat(100_000) + "<".repeat(100_000) + "<a ".repeat(100_000))

    expect(performance.now() - start).toBeLessThan(2000)
  })
})
