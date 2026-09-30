import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeasonFinale } from "../web/pages/SeasonFinale";
import { resolveSitePage } from "../web/siteRoutes";

describe("保研季收官页", () => {
  it("首页和收官地址展示新页面，原工作台只在归档地址展示", () => {
    expect(resolveSitePage("/")).toBe("celebration");
    expect(resolveSitePage("/celebration")).toBe("celebration");
    expect(resolveSitePage("/celebration/")).toBe("celebration");
    expect(resolveSitePage("/archive")).toBe("archive");
    expect(resolveSitePage("/archive/")).toBe("archive");
  });

  it("保留指定文案，公开页面不提供旧工作台入口", () => {
    const html = renderToStaticMarkup(React.createElement(SeasonFinale));
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("保研已经结束啦，祝贺大家圆满完成任务。");
    expect(text).toContain("也许我们下一次保研的时候，我们还会开启我们的系统，给下一届同学做 DDL 的整理。");
    expect(html).toContain('id="letter"');
    expect(html).toContain('id="next-season"');
    expect(html).toContain('src="/assets/season-campus.jpg"');
    expect(html).not.toContain('href="/archive');
  });
});
