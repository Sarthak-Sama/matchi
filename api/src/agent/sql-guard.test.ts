import { describe, expect, it } from "vitest";
import { AGENT_SQL_ROW_LIMIT, guardAgentSql } from "./sql-guard.js";

const codeOf = (sql: unknown) => {
  const result = guardAgentSql(sql);
  return result.ok ? "ok" : result.code;
};

describe("guardAgentSql accepts", () => {
  it("wraps a plain select with LIMIT 50", () => {
    expect(AGENT_SQL_ROW_LIMIT).toBe(50);
    expect(guardAgentSql("  SELECT name, rent_yen FROM agent.areas WHERE ward = 'Setagaya' ORDER BY rent_yen  ")).toEqual({
      ok: true,
      sql: "SELECT * FROM (SELECT name, rent_yen FROM agent.areas WHERE ward = 'Setagaya' ORDER BY rent_yen) q LIMIT 50",
    });
  });

  it("keeps the outer limit even when the query asks for more", () => {
    const result = guardAgentSql("select * from agent.areas limit 5000");
    expect(result.ok && result.sql.endsWith(") q LIMIT 50")).toBe(true);
  });

  it.each([
    "WITH cheap AS (SELECT * FROM agent.areas WHERE rent_yen < 90000) SELECT count(*) FROM cheap",
    "select a.name, round(avg(r.minutes)) from agent.areas a join agent.reach r on r.area_id = a.id group by a.name",
    "select name from agent.areas where id in (select area_id from agent.reach where minutes < 30)",
    "select name from agent.areas where note = 'please update or drop it'",
    "select name, row_number() over (order by rent_yen) from agent.areas offset 5",
    "select agent.score(id) from agent.areas",
    "select x.n from (select count(*) n from agent.areas) x",
  ])("%s", (sql) => expect(codeOf(sql)).toBe("ok"));
});

describe("guardAgentSql rejects", () => {
  it.each([
    ["", "empty"],
    [42, "empty"],
    ["select 1 from agent.areas; select 2 from agent.areas", "multiple_statements"],
    ["select 1 from agent.areas;", "multiple_statements"],
    ["select 1 from agent.areas where note = 'a; b'", "multiple_statements"],
    ["select 1 from agent.areas -- x", "comment"],
    ["select 1 /* x */ from agent.areas", "comment"],
    ["select 1 from \"public\".\"users\"", "forbidden_syntax"],
    ["select $$a$$ from agent.areas", "forbidden_syntax"],
    ["select E'\\'' from agent.areas", "forbidden_syntax"],
    ["select 'abc from agent.areas", "forbidden_syntax"],
    ["insert into agent.areas values (1)", "not_select"],
    ["explain select 1 from agent.areas", "not_select"],
    ["with d as (delete from agent.areas returning *) select * from d", "forbidden_word"],
    ["with u as (UPDATE agent.areas set x = 1 returning *) select * from u", "forbidden_word"],
    ["select * into agent.copy from agent.areas", "forbidden_word"],
    ["select * from agent.areas for update", "forbidden_word"],
    ["select * from users", "forbidden_reference"],
    ["select * from public.users", "forbidden_reference"],
    ["select * from agent.areas a join listings l on l.id = a.id", "forbidden_reference"],
    ["select * from pg_catalog.pg_shadow", "forbidden_reference"],
    ["select * from information_schema.tables", "forbidden_reference"],
    ["select * from tokyo.agent.areas", "forbidden_reference"],
    ["select * from agent.areas, users", "forbidden_reference"],
    ["select * from agent.areas a, users u", "forbidden_reference"],
    ["select * from (select 1 from agent.areas) q, other.users u where true", "forbidden_reference"],
    ["select * from (select 1 from agent.areas) q, agent_sessions s where true", "forbidden_reference"],
    ["select (select turns from agent_sessions limit 1) from agent.areas", "forbidden_reference"],
    ["select pg_sleep(10) from agent.areas", "forbidden_reference"],
    ["select set_config('a','b',false) from agent.areas", "forbidden_function"],
    ["select nextval('s') from agent.areas", "forbidden_function"],
    ["select * from dblink('x','y')", "forbidden_reference"],
    ["select lo_import('/etc/passwd')", "forbidden_function"],
    ["select other.fn(1) from agent.areas", "forbidden_function"],
    ["select 1 from agent.areas where x = 'a' || query_to_xml('select 1',true,true,'')", "forbidden_function"],
  ])("%j -> %s", (sql, code) => expect(codeOf(sql)).toBe(code));

  it("rejects an over-long query", () => {
    expect(codeOf(`select 1 from agent.areas where x in (${"1,".repeat(3000)}1)`)).toBe("too_long");
  });
});
