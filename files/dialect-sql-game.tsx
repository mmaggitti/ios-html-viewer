import React, { useState, useMemo, useEffect, useRef } from "react";

/* ------------------------------------------------------------------
   Dialect — learn SQL like a language
   A token-chip "sentence builder" for SQL, with a dialect phrasebook.
------------------------------------------------------------------- */

/* ---------------- tokenizer (shared by chips + typing mode) -------- */

const PUNCT = "(),;*%+-/:";
const OPCHARS = "<>!=|";

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      out.push(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (PUNCT.includes(c)) { out.push(c); i++; continue; }
    if (OPCHARS.includes(c)) {
      let j = i;
      while (j < src.length && OPCHARS.includes(src[j])) j++;
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    let j = i;
    while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
    if (j === i) j = i + 1;
    out.push(src.slice(i, j));
    i = j;
  }
  return out;
}

function normalize(tokens) {
  const t = tokens.slice();
  while (t.length && t[t.length - 1] === ";") t.pop();
  return t.map((x) => (x.startsWith("'") ? x : x.toUpperCase()));
}

const sameQuery = (a, b) => {
  const A = normalize(a), B = normalize(b);
  return A.length === B.length && A.every((x, i) => x === B[i]);
};

/* ---------------- part of speech, for chip colour ------------------ */

const KEYWORDS = new Set([
  "SELECT","FROM","WHERE","GROUP","BY","ORDER","HAVING","LIMIT","JOIN","LEFT",
  "RIGHT","INNER","FULL","OUTER","ON","AS","AND","OR","NOT","IN","IS","NULL",
  "DESC","ASC","ALL","EXCLUDE","REPLACE","USING","DISTINCT","COUNT","SUM","AVG",
  "MIN","MAX","OFFSET","CURRENT_DATE","BETWEEN","LIKE",
]);

function pos(tok) {
  const u = tok.toUpperCase();
  if (KEYWORDS.has(u)) return "kw";
  if (tok.startsWith("'") || /^[0-9]/.test(tok)) return "val";
  if (PUNCT.includes(tok) || OPCHARS.includes(tok[0])) return "op";
  return "id";
}

function chipPos(label) {
  const toks = tokenize(label);
  const kinds = toks.map(pos).filter((k) => k !== "op");
  return kinds[0] || "op";
}

/* ---------------- the little database ------------------------------ */

const SCHEMA = [
  {
    name: "customers",
    columns: ["id", "name", "city", "joined"],
    rows: [
      [1, "Ada", "Amsterdam", 2021],
      [2, "Bo", "Berlin", 2022],
      [3, "Cleo", "Cadiz", 2022],
      [4, "Dmitri", "Delft", 2023],
      [5, "Eero", "Espoo", 2024],
    ],
  },
  {
    name: "orders",
    columns: ["id", "customer_id", "item", "qty", "price"],
    rows: [
      [101, 1, "mug", 2, 9.5],
      [102, 1, "poster", 1, 14.0],
      [103, 2, "mug", 4, 9.5],
      [104, 3, "sticker", 10, 1.25],
      [105, 3, "mug", 1, 9.5],
      [106, 4, "poster", 3, 14.0],
    ],
  },
];

/* ---------------- the deck ----------------------------------------- */

const LESSONS = [
  {
    id: "l1", unit: "Naming things", flavour: "core",
    prompt: "Ask for every column of every row in customers.",
    bank: ["SELECT", "*", "FROM", "customers", "WHERE"],
    answers: ["SELECT * FROM customers"],
    hint: "Three words: what to show, then where it lives.",
    explain:
      "* is a wildcard standing in for every column. FROM names the table you are reading. This is the smallest complete sentence SQL has.",
    result: { columns: ["id", "name", "city", "joined"], rows: SCHEMA[0].rows },
    dialects: {
      DuckDB: "FROM customers; — SELECT is optional when you want everything.",
      PostgreSQL: "Needs SELECT. TABLE customers; is a rarely used shorthand.",
      SQLite: "Needs SELECT.",
      MySQL: "Needs SELECT.",
    },
  },
  {
    id: "l2", unit: "Naming things", flavour: "core",
    prompt: "List just the name and city of every customer.",
    bank: ["SELECT", "name", ",", "city", "FROM", "customers", "*"],
    answers: ["SELECT name, city FROM customers"],
    hint: "Columns are separated by a comma, like items in a list.",
    explain:
      "Naming columns instead of * is called projection. Order matters — the output columns appear in the order you wrote them.",
    result: {
      columns: ["name", "city"],
      rows: SCHEMA[0].rows.map((r) => [r[1], r[2]]),
    },
    dialects: {
      DuckDB: "Same. A trailing comma before FROM is forgiven.",
      PostgreSQL: "Same, but a trailing comma is a syntax error.",
      SQLite: "Same.",
      MySQL: "Same.",
    },
  },
  {
    id: "l3", unit: "Naming things", flavour: "duckdb",
    prompt: "Say it DuckDB's way: table first, columns second.",
    bank: ["FROM", "customers", "SELECT", "name", ",", "city"],
    answers: ["FROM customers SELECT name, city"],
    hint: "Same words, swapped clauses.",
    explain:
      "DuckDB's grammar accepts both clause orders. Its parser tries the SELECT-first rule, then the FROM-first rule, and takes whichever matches. That is why the order is flexible but not arbitrary — you cannot shuffle clauses freely.",
    result: {
      columns: ["name", "city"],
      rows: SCHEMA[0].rows.map((r) => [r[1], r[2]]),
    },
    dialects: {
      DuckDB: "Valid. Part of what DuckDB calls friendly SQL.",
      PostgreSQL: "Syntax error — SELECT must come first.",
      SQLite: "Syntax error.",
      MySQL: "Syntax error.",
    },
  },
  {
    id: "l4", unit: "Narrowing down", flavour: "core",
    prompt: "Show every column for customers who joined in 2022.",
    bank: ["SELECT", "*", "FROM", "customers", "WHERE", "joined", "=", "2022", "HAVING"],
    answers: ["SELECT * FROM customers WHERE joined = 2022"],
    hint: "WHERE comes after FROM and takes a condition.",
    explain:
      "WHERE tests each row and keeps the ones where the condition is true. A single = means comparison here, not assignment.",
    result: { columns: ["id", "name", "city", "joined"], rows: [SCHEMA[0].rows[1], SCHEMA[0].rows[2]] },
    dialects: {
      DuckDB: "Same everywhere. = is comparison in all four.",
      PostgreSQL: "Same.",
      SQLite: "Also accepts == as a synonym for =.",
      MySQL: "Also has <=> for a NULL-safe comparison.",
    },
  },
  {
    id: "l5", unit: "Narrowing down", flavour: "core",
    prompt: "Find mug orders where more than one was bought.",
    bank: ["SELECT", "*", "FROM", "orders", "WHERE", "item", "=", "'mug'", "AND", "qty", ">", "1", "OR"],
    answers: ["SELECT * FROM orders WHERE item = 'mug' AND qty > 1"],
    hint: "Two conditions joined by AND. Text values go in single quotes.",
    explain:
      "Single quotes mark a text value. Double quotes are different — in most dialects they mean 'this is a column or table name', which is why \"mug\" would fail here.",
    result: {
      columns: ["id", "customer_id", "item", "qty", "price"],
      rows: [SCHEMA[1].rows[0], SCHEMA[1].rows[2]],
    },
    dialects: {
      DuckDB: "'text' is a value, \"thing\" is an identifier.",
      PostgreSQL: "Identical rule.",
      SQLite: "Lenient — \"mug\" falls back to a string if no such column exists.",
      MySQL: "\"mug\" is a string by default, unless ANSI_QUOTES mode is on.",
    },
  },
  {
    id: "l6", unit: "Narrowing down", flavour: "core",
    prompt: "Show customers from Berlin or Cadiz, using one list rather than two comparisons.",
    bank: ["SELECT", "name", ",", "city", "FROM", "customers", "WHERE", "city", "IN", "(", "'Berlin'", ",", "'Cadiz'", ")", "OR"],
    answers: ["SELECT name, city FROM customers WHERE city IN ('Berlin', 'Cadiz')"],
    hint: "IN takes a parenthesised list of values.",
    explain:
      "IN is shorthand for a chain of ORs. It reads better and lets the planner treat the list as a set.",
    result: { columns: ["name", "city"], rows: [["Bo", "Berlin"], ["Cleo", "Cadiz"]] },
    dialects: {
      DuckDB: "Standard. Also supports IN on a list-typed column.",
      PostgreSQL: "Standard. = ANY (ARRAY[...]) is the array-flavoured twin.",
      SQLite: "Standard.",
      MySQL: "Standard.",
    },
  },
  {
    id: "l7", unit: "Arranging", flavour: "core",
    prompt: "Show the three largest orders by quantity, biggest first.",
    bank: ["SELECT", "item", ",", "qty", "FROM", "orders", "ORDER BY", "qty", "DESC", "LIMIT", "3", "ASC"],
    answers: ["SELECT item, qty FROM orders ORDER BY qty DESC LIMIT 3"],
    hint: "Sort before you cut. DESC means largest first.",
    explain:
      "ORDER BY sorts the finished result; LIMIT trims it. Without ORDER BY, LIMIT gives you an arbitrary three rows — the database is not obliged to pick the same three twice.",
    result: { columns: ["item", "qty"], rows: [["sticker", 10], ["mug", 4], ["poster", 3]] },
    dialects: {
      DuckDB: "LIMIT 3, or the standard FETCH FIRST 3 ROWS ONLY.",
      PostgreSQL: "LIMIT 3, or FETCH FIRST 3 ROWS ONLY.",
      SQLite: "LIMIT 3.",
      MySQL: "LIMIT 3. SQL Server, by contrast, writes SELECT TOP 3.",
    },
  },
  {
    id: "l8", unit: "Arranging", flavour: "core",
    prompt: "Glue each name and city into one column called label, reading 'Ada from Amsterdam'.",
    bank: ["SELECT", "name", "||", "' from '", "||", "city", "AS", "label", "FROM", "customers", "+"],
    answers: ["SELECT name || ' from ' || city AS label FROM customers"],
    hint: "|| is the standard concatenation operator. AS renames the result.",
    explain:
      "AS gives a column a readable name. This is the one place dialects disagree loudly: || is standard SQL, but not universal.",
    result: {
      columns: ["label"],
      rows: SCHEMA[0].rows.map((r) => [`${r[1]} from ${r[2]}`]),
    },
    dialects: {
      DuckDB: "|| works. concat() also available.",
      PostgreSQL: "|| works.",
      SQLite: "|| works.",
      MySQL: "|| means OR. Use CONCAT(name, ' from ', city). SQL Server uses +.",
    },
  },
  {
    id: "l9", unit: "Summarizing", flavour: "core",
    prompt: "Count how many orders exist for each item.",
    bank: ["SELECT", "item", ",", "count(*)", "FROM", "orders", "GROUP BY", "item", "WHERE"],
    answers: ["SELECT item, count(*) FROM orders GROUP BY item"],
    hint: "GROUP BY names the column you are collapsing rows into.",
    explain:
      "GROUP BY folds rows into buckets, one per distinct value. count(*) then counts the rows in each bucket. Every non-aggregated column you select must appear in GROUP BY.",
    result: { columns: ["item", "count(*)"], rows: [["mug", 3], ["poster", 2], ["sticker", 1]] },
    dialects: {
      DuckDB: "Standard.",
      PostgreSQL: "Standard, and strict about the grouping rule.",
      SQLite: "Lenient — lets you select ungrouped columns, picking an arbitrary row.",
      MySQL: "Lenient by default in older versions; ONLY_FULL_GROUP_BY makes it strict.",
    },
  },
  {
    id: "l10", unit: "Summarizing", flavour: "duckdb",
    prompt: "Rewrite that count so DuckDB works out the grouping columns for you.",
    bank: ["SELECT", "item", ",", "count(*)", "FROM", "orders", "GROUP BY", "ALL", "item"],
    answers: ["SELECT item, count(*) FROM orders GROUP BY ALL"],
    hint: "One word replaces the column list.",
    explain:
      "GROUP BY ALL groups by every selected column that is not an aggregate. It removes the most common annoyance in analytical SQL: keeping two lists in sync.",
    result: { columns: ["item", "count(*)"], rows: [["mug", 3], ["poster", 2], ["sticker", 1]] },
    dialects: {
      DuckDB: "Supported.",
      PostgreSQL: "Not supported — list the columns.",
      SQLite: "Not supported.",
      MySQL: "Not supported. Snowflake, BigQuery and Spark SQL do support it.",
    },
  },
  {
    id: "l11", unit: "Summarizing", flavour: "core",
    prompt: "Keep only the items that were ordered more than once.",
    bank: ["SELECT", "item", ",", "count(*)", "FROM", "orders", "GROUP BY", "item", "HAVING", "count(*)", ">", "1", "WHERE"],
    answers: ["SELECT item, count(*) FROM orders GROUP BY item HAVING count(*) > 1"],
    hint: "You cannot filter on a count with WHERE. There is a separate word for it.",
    explain:
      "WHERE filters rows before grouping; HAVING filters groups after. That ordering is the whole reason two words exist.",
    result: { columns: ["item", "count(*)"], rows: [["mug", 3], ["poster", 2]] },
    dialects: {
      DuckDB: "Standard, and also lets HAVING refer to a SELECT alias.",
      PostgreSQL: "Standard.",
      SQLite: "Standard.",
      MySQL: "Standard, and also allows aliases in HAVING.",
    },
  },
  {
    id: "l12", unit: "Summarizing", flavour: "core",
    prompt: "Total the revenue per item — quantity times price — and call it revenue.",
    bank: ["SELECT", "item", ",", "sum(", "qty", "*", "price", ")", "AS", "revenue", "FROM", "orders", "GROUP BY", "item", "count("],
    answers: ["SELECT item, sum(qty * price) AS revenue FROM orders GROUP BY item"],
    hint: "Do the multiplication inside the sum, not outside.",
    explain:
      "sum(qty * price) multiplies row by row, then adds. sum(qty) * sum(price) would be a different and wrong number — aggregate last.",
    result: { columns: ["item", "revenue"], rows: [["mug", 66.5], ["poster", 56.0], ["sticker", 12.5]] },
    dialects: {
      DuckDB: "Standard. AS is optional, as it is nearly everywhere.",
      PostgreSQL: "Standard.",
      SQLite: "Standard.",
      MySQL: "Standard.",
    },
  },
  {
    id: "l13", unit: "Relating", flavour: "core",
    prompt: "Pair each order with the customer who placed it. Show the customer name and the item.",
    bank: ["SELECT", "customers.name", ",", "orders.item", "FROM", "customers", "JOIN", "orders", "ON", "customers.id", "=", "orders.customer_id", "WHERE"],
    answers: ["SELECT customers.name, orders.item FROM customers JOIN orders ON customers.id = orders.customer_id"],
    hint: "ON states which column in one table matches which in the other.",
    explain:
      "A join matches rows across tables. The dot notation says which table a column came from — necessary once two tables both have an id.",
    result: {
      columns: ["name", "item"],
      rows: [["Ada", "mug"], ["Ada", "poster"], ["Bo", "mug"], ["Cleo", "sticker"], ["Cleo", "mug"], ["Dmitri", "poster"]],
    },
    dialects: {
      DuckDB: "Standard. Plain JOIN means INNER JOIN.",
      PostgreSQL: "Standard.",
      SQLite: "Standard.",
      MySQL: "Standard. Older code often writes the join condition in WHERE instead.",
    },
  },
  {
    id: "l14", unit: "Relating", flavour: "core",
    prompt: "Now keep every customer, even the one who has never ordered anything.",
    bank: ["SELECT", "customers.name", ",", "orders.item", "FROM", "customers", "LEFT", "JOIN", "orders", "ON", "customers.id", "=", "orders.customer_id", "RIGHT"],
    answers: ["SELECT customers.name, orders.item FROM customers LEFT JOIN orders ON customers.id = orders.customer_id"],
    hint: "One extra word in front of JOIN.",
    explain:
      "LEFT JOIN keeps every row from the left table. Where there is no match, the right-hand columns come back NULL — which is how Eero appears at all.",
    result: {
      columns: ["name", "item"],
      rows: [["Ada", "mug"], ["Ada", "poster"], ["Bo", "mug"], ["Cleo", "sticker"], ["Cleo", "mug"], ["Dmitri", "poster"], ["Eero", null]],
    },
    dialects: {
      DuckDB: "Standard. LEFT OUTER JOIN is the same thing.",
      PostgreSQL: "Standard.",
      SQLite: "Standard. RIGHT and FULL joins arrived only in 3.39.",
      MySQL: "Standard, but has no FULL OUTER JOIN.",
    },
  },
  {
    id: "l15", unit: "Relating", flavour: "core",
    prompt: "Shorten that join by nicknaming the tables c and o.",
    bank: ["SELECT", "c.name", ",", "o.item", "FROM", "customers", "AS", "c", "JOIN", "orders", "AS", "o", "ON", "c.id", "=", "o.customer_id"],
    answers: ["SELECT c.name, o.item FROM customers AS c JOIN orders AS o ON c.id = o.customer_id"],
    hint: "AS renames tables just as it renames columns.",
    explain:
      "Table aliases keep long joins readable, and they are required when you join a table to itself.",
    result: {
      columns: ["name", "item"],
      rows: [["Ada", "mug"], ["Ada", "poster"], ["Bo", "mug"], ["Cleo", "sticker"], ["Cleo", "mug"], ["Dmitri", "poster"]],
    },
    dialects: {
      DuckDB: "AS optional: FROM customers c works.",
      PostgreSQL: "AS optional.",
      SQLite: "AS optional.",
      MySQL: "AS optional.",
    },
  },
  {
    id: "l16", unit: "DuckDB's accent", flavour: "duckdb",
    prompt: "Show every column of orders except price — without typing the other four.",
    bank: ["SELECT", "*", "EXCLUDE", "(", "price", ")", "FROM", "orders", "EXCEPT"],
    answers: ["SELECT * EXCLUDE (price) FROM orders"],
    hint: "It attaches to the star.",
    explain:
      "EXCLUDE subtracts columns from the wildcard. Useful when a table has forty columns and you want thirty-nine.",
    result: {
      columns: ["id", "customer_id", "item", "qty"],
      rows: SCHEMA[1].rows.map((r) => r.slice(0, 4)),
    },
    dialects: {
      DuckDB: "SELECT * EXCLUDE (price).",
      PostgreSQL: "No equivalent — list the columns you want.",
      SQLite: "No equivalent.",
      MySQL: "No equivalent. Snowflake and BigQuery spell it SELECT * EXCEPT (price).",
    },
  },
  {
    id: "l17", unit: "DuckDB's accent", flavour: "duckdb",
    prompt: "Show all of orders with price doubled, still without listing the other columns.",
    bank: ["SELECT", "*", "REPLACE", "(", "price", "*", "2", "AS", "price", ")", "FROM", "orders", "EXCLUDE"],
    answers: ["SELECT * REPLACE (price * 2 AS price) FROM orders"],
    hint: "Same shape as EXCLUDE, but you hand back a new expression under the old name.",
    explain:
      "REPLACE swaps one column's expression while leaving the wildcard otherwise intact — the column also stays in its original position.",
    result: {
      columns: ["id", "customer_id", "item", "qty", "price"],
      rows: SCHEMA[1].rows.map((r) => [r[0], r[1], r[2], r[3], r[4] * 2]),
    },
    dialects: {
      DuckDB: "Supported.",
      PostgreSQL: "No equivalent.",
      SQLite: "No equivalent.",
      MySQL: "No equivalent. BigQuery has SELECT * REPLACE.",
    },
  },
  {
    id: "l18", unit: "DuckDB's accent", flavour: "duckdb",
    prompt: "Name a column with DuckDB's prefix alias instead of AS: revenue, computed as qty times price.",
    bank: ["SELECT", "item", ",", "revenue", ":", "qty", "*", "price", "FROM", "orders", "AS"],
    answers: ["SELECT item, revenue: qty * price FROM orders"],
    hint: "The name comes first, then a colon, then the expression.",
    explain:
      "A prefix alias puts the name where you read it first. It is the same idea as AS, reversed — handy when the expression is long.",
    result: {
      columns: ["item", "revenue"],
      rows: SCHEMA[1].rows.map((r) => [r[2], +(r[3] * r[4]).toFixed(2)]),
    },
    dialects: {
      DuckDB: "name: expression.",
      PostgreSQL: "Not supported — use expression AS name.",
      SQLite: "Not supported.",
      MySQL: "Not supported.",
    },
  },
  {
    id: "l19", unit: "DuckDB's accent", flavour: "duckdb",
    prompt: "DuckDB v2.0 lets you drop SELECT entirely for a bare expression. Ask for today's date, named today.",
    bank: ["today", ":", "current_date", "(", ")", "SELECT", "FROM"],
    answers: ["today: current_date()"],
    hint: "No SELECT, no FROM. Just the named expression.",
    explain:
      "This is an expression statement, new in v2.0. Adding syntax like this used to mean fighting the old Bison grammar; with the PEG parser it is a new rule and a new transform.",
    result: { columns: ["today"], rows: [["2026-08-21"]] },
    dialects: {
      DuckDB: "Valid from v2.0.",
      PostgreSQL: "Needs SELECT current_date AS today.",
      SQLite: "Needs SELECT date('now') AS today.",
      MySQL: "Needs SELECT curdate() AS today.",
    },
  },
];

const DIALECT_NAMES = ["DuckDB", "PostgreSQL", "SQLite", "MySQL"];

/* ---------------- reference: the grammar tree ----------------------
   tree = the language, branch = a category of rule, leaf = one rule.
   support: full | differs | none  (per dialect)
------------------------------------------------------------------- */

const F = "full", D = "differs", N = "none";
const sup = (d, p, s, m) => ({ DuckDB: d, PostgreSQL: p, SQLite: s, MySQL: m });

const GRAMMAR = [
  {
    id: "b-stmt",
    branch: "Statements",
    gloss: "A whole sentence. Everything below is a complete thing you can run.",
    leaves: [
      {
        name: "SELECT statement",
        rule: "SelectStatement <- WithClause? SelectFrom OrderByClause? LimitClause?",
        what: "Reads rows and hands back a result set.",
        example: "SELECT name FROM customers ORDER BY name LIMIT 5;",
        support: sup(F, F, F, F),
      },
      {
        name: "FROM-first SELECT",
        rule: "FromSelectClause <- FromClause SelectClause?",
        what: "Names the table before the columns. SELECT becomes optional.",
        example: "FROM customers SELECT name;\nFROM customers;",
        support: sup(F, N, N, N),
        notes: { DuckDB: "The parser tries SELECT-first, then FROM-first, and keeps the first that matches." },
      },
      {
        name: "Expression statement",
        rule: "ExpressionStatement <- TargetList",
        what: "A bare expression with no SELECT and no table. New in DuckDB v2.0.",
        example: "today: current_date();",
        support: sup(F, N, N, N),
        tag: "v2.0",
      },
      {
        name: "INSERT",
        rule: "INSERT INTO table ColumnList? (VALUES Rows / SelectStatement) Returning?",
        what: "Adds rows, either literal or from a query.",
        example: "INSERT INTO orders VALUES (107, 2, 'mug', 1, 9.50);",
        support: sup(F, F, F, D),
        notes: {
          DuckDB: "INSERT INTO t BY NAME SELECT … matches columns by name rather than position.",
          MySQL: "No RETURNING. Upsert is ON DUPLICATE KEY UPDATE, not ON CONFLICT.",
        },
      },
      {
        name: "UPDATE",
        rule: "UPDATE table SET Assignments FromClause? WhereClause?",
        what: "Changes values in rows that match a condition.",
        example: "UPDATE orders SET qty = qty + 1 WHERE id = 101;",
        support: sup(F, F, D, D),
        notes: {
          SQLite: "UPDATE … FROM arrived in 3.33.",
          MySQL: "No FROM clause — you write a multi-table UPDATE instead.",
        },
      },
      {
        name: "DELETE",
        rule: "DELETE FROM table UsingClause? WhereClause?",
        what: "Removes rows. Without WHERE, it removes all of them.",
        example: "DELETE FROM orders WHERE qty = 0;",
        support: sup(F, F, F, F),
        notes: { DuckDB: "TRUNCATE t is accepted as a synonym for the unfiltered form." },
      },
      {
        name: "CREATE TABLE AS",
        rule: "CREATE (OR REPLACE)? TABLE name AS SelectStatement",
        what: "Builds a new table from the shape and contents of a query.",
        example: "CREATE TABLE mugs AS SELECT * FROM orders WHERE item = 'mug';",
        support: sup(F, F, D, D),
        notes: {
          SQLite: "No OR REPLACE — drop the table first.",
          MySQL: "Written CREATE TABLE t SELECT …, and no OR REPLACE.",
        },
      },
      {
        name: "COPY",
        rule: "COPY (table / query) TO 'path' '(' Options ')'",
        what: "Moves data between tables and files in bulk.",
        example: "COPY orders TO 'orders'\n  (FORMAT parquet, PARTITION BY (year, month), ORDER BY (order_date));",
        support: sup(F, D, N, N),
        notes: {
          DuckDB: "PARTITION BY and ORDER BY are new in v2.0.",
          PostgreSQL: "Server-side only, csv/text/binary, no partitioning.",
          SQLite: "Nothing in SQL — the CLI has .import and .output.",
          MySQL: "Use LOAD DATA INFILE and SELECT … INTO OUTFILE.",
        },
      },
      {
        name: "CONNECT / DISCONNECT",
        rule: "CONNECT 'url' ; … ; DISCONNECT",
        what: "Points the session at a remote database, so later queries run there.",
        example: "CONNECT 'postgres://localhost/mydb';\nSELECT count(*) FROM orders;\nDISCONNECT;",
        support: sup(F, N, N, N),
        tag: "v2.0",
        notes: { DuckDB: "Introduced for Quack, DuckDB's remote protocol." },
      },
      {
        name: "External resources",
        rule: "CREATE / REGISTER / SHOW / CONNECT TO / DESTROY EXTERNAL RESOURCE",
        what: "Manages things that live outside DuckDB, through an extension.",
        example: "CREATE EXTERNAL RESOURCE '<type>' AS <name> (…);\nSHOW EXTERNAL RESOURCES;",
        support: sup(F, N, N, N),
        tag: "preview",
        notes: { DuckDB: "Announced for v2.0; the exact syntax may still shift." },
      },
    ],
  },
  {
    id: "b-clause",
    branch: "Clauses",
    gloss: "The named parts of a SELECT. Order between them is fixed, not free.",
    leaves: [
      {
        name: "Target list",
        rule: "TargetList <- TargetElement (',' TargetElement)*",
        what: "The columns and expressions you are asking for.",
        example: "SELECT item, qty * price AS revenue",
        support: sup(F, F, F, F),
        notes: { DuckDB: "A trailing comma before FROM is forgiven; elsewhere it is a syntax error." },
      },
      {
        name: "FROM",
        rule: "FromClause <- 'FROM' TableRef (',' TableRef)*",
        what: "Where the rows come from: tables, subqueries, functions, files.",
        example: "FROM customers, orders",
        support: sup(F, F, F, F),
      },
      {
        name: "WHERE",
        rule: "WhereClause <- 'WHERE' Expression",
        what: "Tests each row before grouping; keeps the ones that are true.",
        example: "WHERE qty > 1 AND item = 'mug'",
        support: sup(F, F, F, F),
      },
      {
        name: "GROUP BY",
        rule: "GroupByClause <- 'GROUP' 'BY' ('ALL' / GroupingElements)",
        what: "Folds rows into buckets so aggregates can collapse them.",
        example: "GROUP BY item\nGROUP BY ALL",
        support: sup(F, D, D, D),
        notes: {
          DuckDB: "ALL infers the grouping columns from the target list.",
          PostgreSQL: "No ALL, but has ROLLUP, CUBE and GROUPING SETS.",
          SQLite: "No ALL, no ROLLUP.",
          MySQL: "No ALL. WITH ROLLUP instead.",
        },
      },
      {
        name: "HAVING",
        rule: "HavingClause <- 'HAVING' Expression",
        what: "Filters groups after aggregation, the way WHERE filters rows before it.",
        example: "HAVING count(*) > 1",
        support: sup(F, F, F, F),
        notes: {
          DuckDB: "Can refer to a SELECT alias.",
          PostgreSQL: "Cannot refer to a SELECT alias — repeat the expression.",
        },
      },
      {
        name: "QUALIFY",
        rule: "QualifyClause <- 'QUALIFY' Expression",
        what: "Filters on the result of a window function, without a wrapping subquery.",
        example: "QUALIFY row_number() OVER (PARTITION BY item ORDER BY qty DESC) = 1",
        support: sup(F, N, N, N),
        notes: { PostgreSQL: "Wrap the query in a subquery and filter outside it." },
      },
      {
        name: "Window functions",
        rule: "FunctionCall 'OVER' (WindowName / WindowSpec)",
        what: "Computes across a moving frame of rows without collapsing them.",
        example: "sum(qty) OVER (PARTITION BY item ORDER BY id)",
        support: sup(F, F, F, F),
        notes: { SQLite: "Since 3.25.", MySQL: "Since 8.0." },
      },
      {
        name: "ORDER BY",
        rule: "OrderByClause <- 'ORDER' 'BY' ('ALL' / OrderElements)",
        what: "Sorts the finished result. Without it, row order is not promised.",
        example: "ORDER BY qty DESC NULLS LAST\nORDER BY ALL",
        support: sup(F, D, D, D),
        notes: {
          DuckDB: "ORDER BY ALL sorts by every selected column, left to right.",
          PostgreSQL: "NULLS FIRST/LAST yes; ORDER BY ALL no.",
          MySQL: "No NULLS FIRST/LAST and no ALL.",
        },
      },
      {
        name: "LIMIT / OFFSET",
        rule: "LimitClause <- 'LIMIT' Expression OffsetClause?",
        what: "Trims the result to a count, optionally skipping rows first.",
        example: "LIMIT 3 OFFSET 10",
        support: sup(F, F, F, D),
        notes: {
          PostgreSQL: "Also accepts the standard FETCH FIRST n ROWS ONLY.",
          MySQL: "Also the older LIMIT offset, count form — arguments reversed.",
        },
      },
      {
        name: "WITH (common table expressions)",
        rule: "WithClause <- 'WITH' 'RECURSIVE'? CTE (',' CTE)*",
        what: "Names a subquery up front so the main query stays readable.",
        example: "WITH big AS (SELECT * FROM orders WHERE qty > 2)\nSELECT * FROM big;",
        support: sup(F, F, F, D),
        notes: {
          MySQL: "Since 8.0. No MATERIALIZED / NOT MATERIALIZED hint.",
        },
      },
      {
        name: "USING SAMPLE",
        rule: "SampleClause <- 'USING' 'SAMPLE' SampleSpec",
        what: "Takes a random subset — useful when exploring a large table.",
        example: "SELECT * FROM orders USING SAMPLE 10%;",
        support: sup(F, D, N, N),
        notes: { PostgreSQL: "Has TABLESAMPLE, with different syntax and semantics." },
      },
    ],
  },
  {
    id: "b-table",
    branch: "Table references",
    gloss: "Everything that can legally appear after FROM.",
    leaves: [
      {
        name: "Base table",
        rule: "BaseTable <- QualifiedName ('AS'? Alias)?",
        what: "A plain table, optionally schema-qualified and nicknamed.",
        example: "FROM main.customers AS c",
        support: sup(F, F, F, F),
      },
      {
        name: "Subquery",
        rule: "SubqueryRef <- '(' SelectStatement ')' ('AS'? Alias)?",
        what: "A query used where a table would go.",
        example: "FROM (SELECT * FROM orders WHERE qty > 2) AS big",
        support: sup(F, F, F, F),
        notes: { PostgreSQL: "The alias is mandatory.", MySQL: "The alias is mandatory." },
      },
      {
        name: "JOIN",
        rule: "JoinRef <- TableRef JoinType 'JOIN' TableRef ('ON' Expr / 'USING' '(' Cols ')')",
        what: "Matches rows across two tables.",
        example: "FROM customers c JOIN orders o ON c.id = o.customer_id",
        support: sup(F, F, D, D),
        notes: {
          SQLite: "RIGHT and FULL OUTER JOIN only from 3.39.",
          MySQL: "No FULL OUTER JOIN — emulate with UNION.",
        },
      },
      {
        name: "LATERAL",
        rule: "'LATERAL' (SubqueryRef / FunctionRef)",
        what: "Lets a subquery on the right see columns from the table on the left.",
        example: "FROM customers c, LATERAL (SELECT max(qty) FROM orders WHERE customer_id = c.id) m",
        support: sup(F, F, N, D),
        notes: { MySQL: "Since 8.0.14." },
      },
      {
        name: "ASOF JOIN",
        rule: "TableRef 'ASOF' 'JOIN' TableRef 'ON' InequalityCondition",
        what: "Matches each row to the nearest earlier row on the other side — built for time series.",
        example: "FROM prices p ASOF JOIN quotes q ON p.ts >= q.ts",
        support: sup(F, N, N, N),
      },
      {
        name: "POSITIONAL JOIN",
        rule: "TableRef 'POSITIONAL' 'JOIN' TableRef",
        what: "Zips two tables together by row number, with no join key at all.",
        example: "FROM a POSITIONAL JOIN b",
        support: sup(F, N, N, N),
      },
      {
        name: "Table functions",
        rule: "FunctionRef <- FunctionName '(' Args ')' ('AS'? Alias ColumnAliases?)?",
        what: "A function that returns rows instead of a value.",
        example: "FROM range(6) t(i)\nFROM read_csv('data/*.csv')",
        support: sup(F, D, D, D),
        notes: {
          PostgreSQL: "Has generate_series and other set-returning functions, but no file readers.",
          SQLite: "Only through extensions.",
          MySQL: "Only JSON_TABLE.",
        },
      },
      {
        name: "Files as tables",
        rule: "BaseTable <- StringLiteral",
        what: "Query a CSV, Parquet or JSON file directly by path or glob.",
        example: "SELECT * FROM 'orders/*.parquet';",
        support: sup(F, N, N, N),
      },
      {
        name: "VALUES list",
        rule: "ValuesRef <- 'VALUES' Row (',' Row)*",
        what: "An inline literal table.",
        example: "FROM (VALUES ('a', 1), ('b', 2)) AS t(letter, n)",
        support: sup(F, F, F, D),
        notes: { MySQL: "Since 8.0.19, written VALUES ROW(…)." },
      },
      {
        name: "UNNEST",
        rule: "'UNNEST' '(' Expression ')'",
        what: "Turns a list-valued column into one row per element.",
        example: "SELECT unnest([1, 2, 3]) AS n;",
        support: sup(F, F, N, N),
        notes: { MySQL: "Nearest equivalent is JSON_TABLE." },
      },
    ],
  },
  {
    id: "b-expr",
    branch: "Expressions",
    gloss: "The parts that produce a value rather than a row set.",
    leaves: [
      {
        name: "Operator precedence",
        rule: "OR  <  AND  <  NOT  <  comparison  <  ||  <  + -  <  * / %",
        what: "Which operator binds tighter when you leave the parentheses out.",
        example: "SELECT true OR true AND false;\n-- reads as: true OR (true AND false)",
        support: sup(F, F, F, F),
        notes: { DuckDB: "The PEG grammar spells precedence out as a ladder of rules rather than as separate precedence declarations." },
      },
      {
        name: "String concatenation",
        rule: "Expression '||' Expression",
        what: "Glues two text values together.",
        example: "SELECT name || ' from ' || city;",
        support: sup(F, F, F, N),
        notes: { MySQL: "|| means OR. Use CONCAT(a, b). SQL Server uses +." },
      },
      {
        name: "CAST",
        rule: "'CAST' '(' Expr 'AS' Type ')'  /  Expr '::' Type",
        what: "Converts a value to another type.",
        example: "SELECT CAST('42' AS INTEGER), '42'::INTEGER;",
        support: sup(F, F, D, D),
        notes: {
          SQLite: "CAST only — no :: shorthand, and a loose type system underneath.",
          MySQL: "CAST only, with a restricted set of target types.",
        },
      },
      {
        name: "CASE",
        rule: "'CASE' ('WHEN' Expr 'THEN' Expr)+ ('ELSE' Expr)? 'END'",
        what: "Inline branching. The SQL equivalent of if/else.",
        example: "CASE WHEN qty > 5 THEN 'bulk' ELSE 'small' END",
        support: sup(F, F, F, F),
      },
      {
        name: "IS DISTINCT FROM",
        rule: "Expr 'IS' 'NOT'? 'DISTINCT' 'FROM' Expr",
        what: "Compares two values treating NULL as an ordinary value, so NULL equals NULL.",
        example: "WHERE city IS DISTINCT FROM 'Berlin'",
        support: sup(F, F, F, D),
        notes: { MySQL: "Use the null-safe operator a <=> b." },
      },
      {
        name: "Subquery expressions",
        rule: "Expr 'IN' '(' SelectStatement ')'  /  'EXISTS' '(' SelectStatement ')'",
        what: "A query used where a value or a truth test would go.",
        example: "WHERE id IN (SELECT customer_id FROM orders)",
        support: sup(F, F, D, F),
        notes: { SQLite: "IN and EXISTS yes; ANY and ALL over a subquery are not supported." },
      },
      {
        name: "Lambdas",
        rule: "FunctionCall with parameter -> body",
        what: "An inline function passed to a list function.",
        example: "SELECT list_transform([1, 2, 3], x -> x * 2);",
        support: sup(F, N, N, N),
      },
      {
        name: "List comprehension",
        rule: "'[' Expr 'for' Ident 'in' Expr ('if' Expr)? ']'",
        what: "Python-style list building, inside SQL.",
        example: "SELECT [x * 2 FOR x IN [1, 2, 3] IF x > 1];",
        support: sup(F, N, N, N),
      },
      {
        name: "Nested type access",
        rule: "Expr '.' Field  /  Expr '[' Index ']'",
        what: "Reaches into a struct, list or map value.",
        example: "SELECT s.name, l[1], m['key'];",
        support: sup(F, D, N, N),
        notes: {
          PostgreSQL: "Arrays and composite types exist, with different syntax and 1-based indexing.",
          SQLite: "Nothing native — store JSON and use json_extract.",
        },
      },
      {
        name: "COLUMNS expression",
        rule: "'COLUMNS' '(' (Pattern / Lambda / '*') ')'",
        what: "Applies one expression to many columns at once, chosen by pattern.",
        example: "SELECT min(COLUMNS('^qty|price$')) FROM orders;",
        support: sup(F, N, N, N),
      },
    ],
  },
  {
    id: "b-lex",
    branch: "Names, literals, comments",
    gloss: "Tokenizer territory. Decided before the grammar ever sees the query.",
    leaves: [
      {
        name: "String literals",
        rule: "\"'\" (!\"'\" .)* \"'\"",
        what: "Text goes in single quotes. Double a quote to escape it.",
        example: "SELECT 'it''s fine';",
        support: sup(F, F, F, D),
        notes: { MySQL: "Also accepts backslash escapes, unless NO_BACKSLASH_ESCAPES is set." },
      },
      {
        name: "Quoted identifiers",
        rule: "'\"' (!'\"' .)* '\"'",
        what: "Double quotes mean 'this is a name', not a value — the opposite of single quotes.",
        example: "SELECT \"order\" FROM \"my table\";",
        support: sup(F, F, F, D),
        notes: { MySQL: "Backticks by default; double quotes only in ANSI_QUOTES mode. SQL Server uses [brackets]." },
      },
      {
        name: "Case folding",
        rule: "Identifier <- [A-Za-z_] [A-Za-z0-9_$]*",
        what: "Whether Name, name and NAME are the same thing.",
        example: "SELECT Name FROM Customers;",
        support: sup(F, D, D, D),
        notes: {
          DuckDB: "Case-insensitive, and preserves the case you typed in the output.",
          PostgreSQL: "Folds unquoted names to lowercase; quoted names are exact.",
          SQLite: "Case-insensitive for ASCII identifiers.",
          MySQL: "Column names case-insensitive; table names follow the filesystem.",
        },
      },
      {
        name: "Reserved keywords",
        rule: "Keyword categories: RESERVED / partially reserved / unreserved",
        what: "Some words cannot be used unquoted as a table or column name.",
        example: "SELECT \"select\" FROM t;  -- quoting rescues it",
        support: sup(D, D, D, D),
        notes: {
          DuckDB: "Each dialect reserves a different list, so a portable name avoids all of them. Extensions can register new keywords at load time.",
        },
      },
      {
        name: "Comments",
        rule: "'--' (!EOL .)*   /   '/*' (!'*/' .)* '*/'",
        what: "Skipped by the tokenizer before parsing begins.",
        example: "-- a line comment\n/* a block comment */",
        support: sup(F, F, F, D),
        notes: { MySQL: "# also starts a line comment; -- needs a space after it." },
      },
      {
        name: "Numeric literals",
        rule: "Number <- Digits ('.' Digits)? Exponent?",
        what: "Digits, optionally with a decimal point, exponent or digit separators.",
        example: "SELECT 1_000_000, 1.5e3;",
        support: sup(F, D, D, D),
        notes: {
          DuckDB: "Underscore separators are allowed.",
          PostgreSQL: "Underscore separators from v16.",
          SQLite: "No underscore separators.",
          MySQL: "No underscore separators.",
        },
      },
    ],
  },
  {
    id: "b-friendly",
    branch: "DuckDB's accent",
    gloss: "Shorthand DuckDB added on top of the PostgreSQL-shaped core.",
    leaves: [
      {
        name: "SELECT * EXCLUDE",
        rule: "'*' 'EXCLUDE' '(' ColumnList ')'",
        what: "Every column except the ones you name.",
        example: "SELECT * EXCLUDE (price) FROM orders;",
        support: sup(F, N, N, N),
        notes: { DuckDB: "Snowflake, BigQuery and Databricks spell the same idea SELECT * EXCEPT (…)." },
      },
      {
        name: "SELECT * REPLACE",
        rule: "'*' 'REPLACE' '(' Expr 'AS' Name (',' …)* ')'",
        what: "Every column, but with one swapped for a new expression, in place.",
        example: "SELECT * REPLACE (price * 2 AS price) FROM orders;",
        support: sup(F, N, N, N),
      },
      {
        name: "SELECT * RENAME",
        rule: "'*' 'RENAME' '(' Name 'AS' Name (',' …)* ')'",
        what: "Every column, with some renamed and none dropped.",
        example: "SELECT * RENAME (qty AS quantity) FROM orders;",
        support: sup(F, N, N, N),
      },
      {
        name: "Prefix alias",
        rule: "TargetElement <- (Identifier ':')? Expression",
        what: "Puts the column name before the expression instead of after it.",
        example: "SELECT revenue: qty * price FROM orders;",
        support: sup(F, N, N, N),
      },
      {
        name: "Reusable aliases",
        rule: "An alias defined earlier in the target list is visible later in it.",
        what: "Lets you build one column out of another without repeating yourself.",
        example: "SELECT qty * price AS revenue, revenue * 0.2 AS tax FROM orders;",
        support: sup(F, N, N, D),
        notes: {
          PostgreSQL: "Repeat the expression, or wrap it in a subquery or CTE.",
          MySQL: "Aliases work in GROUP BY, HAVING and ORDER BY, but not inside the SELECT list.",
        },
      },
      {
        name: "UNION BY NAME",
        rule: "SelectStatement 'UNION' ('ALL')? 'BY' 'NAME' SelectStatement",
        what: "Stacks results by matching column names rather than positions.",
        example: "SELECT a, b FROM t1 UNION BY NAME SELECT b, a FROM t2;",
        support: sup(F, N, N, N),
      },
      {
        name: "Function chaining",
        rule: "Expression '.' FunctionCall",
        what: "Reads left to right: the value first, the operation second.",
        example: "SELECT 'quack'.upper().reverse();",
        support: sup(F, N, N, N),
      },
      {
        name: "Integer division",
        rule: "Expression '//' Expression",
        what: "Divides and truncates, without casting first.",
        example: "SELECT 7 // 2;  -- 3",
        support: sup(F, N, N, N),
        notes: { PostgreSQL: "Integer / integer already truncates, so / does this job." },
      },
      {
        name: "DESCRIBE and SUMMARIZE",
        rule: "'DESCRIBE' Query  /  'SUMMARIZE' Query",
        what: "Shows column types, or per-column statistics, for any query.",
        example: "SUMMARIZE SELECT * FROM orders;",
        support: sup(F, D, D, D),
        notes: {
          PostgreSQL: "\\d in psql is the closest thing.",
          MySQL: "DESCRIBE exists for tables, but there is no SUMMARIZE.",
        },
      },
      {
        name: "Trailing commas",
        rule: "List <- Item (',' Item)* ','?",
        what: "A dangling comma before the next keyword is accepted, not an error.",
        example: "SELECT name, city, FROM customers;",
        support: sup(F, N, N, N),
      },
    ],
  },
  {
    id: "b-parser",
    branch: "How the parser reads it",
    gloss: "Not dialect rules — the machinery underneath, as of DuckDB v2.0.",
    noMatrix: true,
    leaves: [
      {
        name: "The pipeline",
        rule: "tokenizer → parser → transformer → binder → optimizer → execution",
        what: "The tokenizer splits text into tokens, the parser checks grammar, the transformer builds DuckDB's AST, and the binder resolves names against the catalogue.",
        example: "-- parser's job:  is this a sentence?\n-- binder's job:  do these things exist?",
      },
      {
        name: "PEG operators",
        rule: "<- define    / ordered choice    ? optional    * zero or more\n+ one or more    & and-predicate    ! not-predicate",
        what: "The whole notation. Every rule in this reference is written with it.",
        example: "SelectFrom <- SelectFromClause / FromSelectClause\nSelectFromClause <- SelectClause FromClause?",
      },
      {
        name: "Ordered choice",
        rule: "A <- B / C   — try B; only if it fails, try C",
        what: "Alternatives are tried in the order written, and the first match wins. There is no ambiguity to resolve, which is why PEG grammars avoid the shift/reduce conflicts that made the old Bison grammar hard to extend.",
        example: "SelectAtom <- PipeSelectAtom / SelectParens / SelectStatementType",
      },
      {
        name: "Packrat memoization",
        rule: "cache[(rule, position)] → result",
        what: "Each memoized rule is evaluated at most once per token position. Without it, backtracking over malformed input can blow up exponentially — 19 unmatched opening parentheses took about ten seconds before, and about a millisecond after.",
        example: "SELECT ((((((((((((((((((;",
      },
      {
        name: "Parser error vs catalog error",
        rule: "syntax checked first, existence checked second",
        what: "A parser error means the words are in an order the grammar does not accept. A catalog error means the sentence was fine but the table or column is not there.",
        example: "SELECT * WHERE true FROM t;  -- parser error\nFROM missing_table;          -- catalog error",
      },
      {
        name: "Grammar extensions",
        rule: "extension registers: grammar text + extension point + transformer + keywords",
        what: "An extension can add rules as new alternatives at defined extension points, reuse the rest of DuckSQL, and only transform the syntax it introduced. Previously, extensions worked as fallback parsers and had to reimplement the surrounding SQL themselves.",
        example: "extension.grammar_extension.select_atom_rule = \"PipeSelectAtom\";",
        tag: "preview",
      },
    ],
  },
];

/* ---------------- helpers ------------------------------------------ */

function seededShuffle(arr, seed) {
  const a = arr.slice();
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const hash = (s) => s.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100000, 7);

const cell = (v) => (v === null || v === undefined ? "NULL" : String(v));

/* ---------------- styles ------------------------------------------- */

const CSS = `
.dlg { 
  --canvas:#F7F2E9; --paper:#FDFBF6; --edge:#E6DCC9; --edge-soft:#EFE6D6;
  --ink:#3A342C; --muted:#847A68; --faint:#A79C88;
  --peri:#AAB4DE; --peri-ink:#4C548A; --peri-soft:#E7EAF7;
  --sage:#A6C2A6; --sage-ink:#4C6B4E; --sage-soft:#E6EFE4;
  --lilac:#C7B2D9; --lilac-ink:#6A5382; --lilac-soft:#F0E9F5;
  --butter:#E6CF9C; --butter-ink:#7E6524; --butter-soft:#F8EFD8;
  --rose:#DFAAA6; --rose-ink:#8C4F4A; --rose-soft:#F7E6E3;
  background:var(--canvas); color:var(--ink); min-height:100vh;
  font-family:'Iowan Old Style','Palatino Linotype','Book Antiqua',Palatino,Georgia,serif;
  padding:18px 14px 56px;
}
.dlg *, .dlg *::before, .dlg *::after { box-sizing:border-box; }
.dlg-wrap { max-width:600px; margin:0 auto; }
.dlg-mono { font-family:ui-monospace,'SF Mono',Menlo,'Cascadia Mono','Roboto Mono',monospace; }
.dlg-label {
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  font-size:10px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--faint); font-weight:600;
}

/* masthead */
.dlg-top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:4px; }
.dlg-title { font-size:27px; font-weight:600; letter-spacing:-.02em; margin:0; }
.dlg-sub { font-size:13.5px; color:var(--muted); font-style:italic; margin:0 0 14px; }
.dlg-score { font-size:12px; color:var(--muted); white-space:nowrap; }
.dlg-score b { color:var(--peri-ink); font-size:15px; }

/* progress: a row of ticks, one per lesson */
.dlg-ticks { display:flex; gap:3px; margin-bottom:16px; }
.dlg-tick { height:4px; flex:1; border-radius:2px; background:var(--edge-soft); transition:background .25s; }
.dlg-tick.done { background:var(--sage); }
.dlg-tick.now  { background:var(--peri); }

/* card */
.dlg-card {
  background:var(--paper); border:1px solid var(--edge); border-radius:16px;
  padding:18px 16px; box-shadow:0 1px 0 rgba(58,52,44,.04), 0 8px 22px -18px rgba(58,52,44,.4);
  margin-bottom:14px;
}
.dlg-eyebrow { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
.dlg-badge {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; font-weight:600; padding:3px 8px; border-radius:999px;
}
.dlg-badge.duck { background:var(--butter-soft); color:var(--butter-ink); }
.dlg-badge.core { background:var(--peri-soft); color:var(--peri-ink); }
.dlg-prompt { font-size:20px; line-height:1.4; margin:0 0 4px; letter-spacing:-.01em; }

/* the ruled answer line — signature element */
.dlg-slate {
  margin:16px 0 6px; padding:14px 12px 10px; border-radius:12px;
  background:
    repeating-linear-gradient(to bottom, transparent, transparent 33px, var(--edge-soft) 33px, var(--edge-soft) 34px);
  border:1px solid var(--edge-soft); min-height:74px;
}
.dlg-line { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.dlg-empty { color:var(--faint); font-size:14px; font-style:italic; }

/* chips */
.dlg-chip {
  font-family:ui-monospace,'SF Mono',Menlo,'Cascadia Mono',monospace;
  font-size:14px; padding:6px 10px; border-radius:8px; border:1px solid transparent;
  cursor:pointer; transition:transform .08s ease, box-shadow .15s ease, opacity .15s;
  line-height:1.2; white-space:nowrap;
}
.dlg-chip:active { transform:translateY(1px); }
.dlg-chip:focus-visible { outline:2px solid var(--peri-ink); outline-offset:2px; }
.dlg-chip.kw  { background:var(--peri-soft);   color:var(--peri-ink);   border-color:#D5DAEF; }
.dlg-chip.id  { background:var(--sage-soft);   color:var(--sage-ink);   border-color:#D6E3D3; }
.dlg-chip.op  { background:var(--lilac-soft);  color:var(--lilac-ink);  border-color:#E3D8EC; }
.dlg-chip.val { background:var(--butter-soft); color:var(--butter-ink); border-color:#EFE2C2; }
.dlg-chip.spent { opacity:.25; cursor:default; }
.dlg-bank { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }

/* clause rail */
.dlg-rail { display:flex; gap:0; align-items:center; margin-top:12px; padding-top:2px; }
.dlg-rail-seg { display:flex; align-items:center; gap:6px; }
.dlg-rail-dot { width:7px; height:7px; border-radius:99px; background:var(--edge); transition:background .3s; }
.dlg-rail-dot.lit { background:var(--sage); }
.dlg-rail-name {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:9.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint); transition:color .3s;
}
.dlg-rail-name.lit { color:var(--sage-ink); }
.dlg-rail-bar { width:16px; height:1px; background:var(--edge); margin:0 6px; }

/* buttons */
.dlg-actions { display:flex; gap:8px; margin-top:14px; flex-wrap:wrap; }
.dlg-btn {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:13.5px; font-weight:600;
  padding:10px 16px; border-radius:10px; border:1px solid var(--edge); background:var(--paper);
  color:var(--ink); cursor:pointer; transition:background .15s, border-color .15s;
}
.dlg-btn:hover { background:#F5F0E5; }
.dlg-btn:focus-visible { outline:2px solid var(--peri-ink); outline-offset:2px; }
.dlg-btn.primary { background:var(--peri); border-color:var(--peri); color:#2C3160; }
.dlg-btn.primary:hover { background:#9FAADA; }
.dlg-btn.go { background:var(--sage); border-color:var(--sage); color:#33482F; }
.dlg-btn.go:hover { background:#9BBB9B; }
.dlg-btn.ghost { background:transparent; border-color:transparent; color:var(--muted); padding:10px 8px; }
.dlg-btn.ghost:hover { color:var(--ink); background:#F2ECE0; }
.dlg-btn[disabled] { opacity:.4; cursor:default; }

/* feedback */
.dlg-note { margin-top:14px; padding:12px 14px; border-radius:12px; font-size:14.5px; line-height:1.5; }
.dlg-note.good { background:var(--sage-soft); border:1px solid #D6E3D3; color:#3F5C41; }
.dlg-note.bad  { background:var(--rose-soft); border:1px solid #EFD3CF; color:var(--rose-ink); }
.dlg-note.tip  { background:var(--butter-soft); border:1px solid #EFE2C2; color:var(--butter-ink); }

/* result table */
.dlg-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.dlg-tbl { border-collapse:collapse; font-family:ui-monospace,Menlo,monospace; font-size:12.5px; width:100%; }
.dlg-tbl th {
  text-align:left; padding:6px 12px 6px 0; border-bottom:1px solid var(--edge);
  font-weight:600; color:var(--muted); white-space:nowrap;
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:10px;
  letter-spacing:.1em; text-transform:uppercase;
}
.dlg-tbl td { padding:5px 12px 5px 0; border-bottom:1px solid var(--edge-soft); white-space:nowrap; }
.dlg-tbl td.null { color:var(--faint); font-style:italic; }

/* phrasebook */
.dlg-phrase { display:grid; grid-template-columns:auto 1fr; gap:6px 12px; align-items:baseline; margin-top:8px; }
.dlg-dname {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:11px; font-weight:700;
  color:var(--lilac-ink); white-space:nowrap; padding-top:1px;
}
.dlg-dtext { font-size:13.5px; line-height:1.45; color:var(--muted); }
.dlg-dtext code { font-family:ui-monospace,Menlo,monospace; font-size:12.5px; color:var(--ink); }

/* misc */
.dlg-tabs { display:flex; gap:4px; margin-bottom:14px; }
.dlg-tab {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:12px; font-weight:600;
  padding:6px 12px; border-radius:999px; border:1px solid var(--edge);
  background:transparent; color:var(--muted); cursor:pointer;
}
.dlg-tab[aria-selected="true"] { background:var(--ink); color:var(--canvas); border-color:var(--ink); }
.dlg-input {
  width:100%; font-family:ui-monospace,Menlo,monospace; font-size:15px; padding:12px;
  border-radius:10px; border:1px solid var(--edge); background:var(--paper); color:var(--ink);
  resize:vertical; min-height:78px;
}
.dlg-input:focus-visible { outline:2px solid var(--peri-ink); outline-offset:1px; }
.dlg-legend { display:flex; gap:12px; flex-wrap:wrap; margin-top:10px; }
.dlg-leg { display:flex; align-items:center; gap:5px; }
.dlg-swatch { width:9px; height:9px; border-radius:3px; }
.dlg-h { font-size:17px; margin:0 0 8px; font-weight:600; }
/* ---- reference tree ---- */
.dlg-doc {
  position:relative; border:1px solid var(--edge); border-radius:14px;
  background:var(--paper); overflow:hidden;
  box-shadow:0 1px 0 rgba(58,52,44,.04), 0 8px 22px -18px rgba(58,52,44,.4);
}
.dlg-scrollpane {
  max-height:66vh; overflow-y:auto; overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch; padding:0 0 10px;
}
.dlg-doc::after {
  content:""; position:absolute; left:0; right:0; bottom:0; height:26px; pointer-events:none;
  background:linear-gradient(to bottom, rgba(253,251,246,0), var(--paper));
}
.dlg-trunk { padding:14px 14px 4px; border-bottom:1px solid var(--edge-soft); }
.dlg-trunk-name { font-size:19px; font-weight:600; margin:0 0 2px; letter-spacing:-.01em; }
.dlg-trunk-gloss { font-size:13px; color:var(--muted); line-height:1.45; margin:0 0 10px; font-style:italic; }

.dlg-bhead {
  position:sticky; top:0; z-index:3; background:var(--paper);
  display:flex; align-items:center; gap:9px; width:100%; text-align:left;
  padding:11px 14px; border:0; border-bottom:1px solid var(--edge-soft);
  cursor:pointer; font-family:inherit; color:var(--ink);
}
.dlg-bhead:hover { background:#F6F1E6; }
.dlg-bhead:focus-visible { outline:2px solid var(--peri-ink); outline-offset:-2px; }
.dlg-node { width:9px; height:9px; border-radius:2px; background:var(--peri); flex:none; }
.dlg-bname { font-size:15.5px; font-weight:600; flex:1; letter-spacing:-.01em; }
.dlg-count {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:10.5px; color:var(--faint);
  background:var(--canvas); border-radius:999px; padding:2px 7px; font-weight:600;
}
.dlg-caret { color:var(--faint); font-size:11px; transition:transform .2s; flex:none; }
.dlg-caret.open { transform:rotate(90deg); }
.dlg-bgloss { padding:0 14px 10px 32px; font-size:12.5px; color:var(--muted); line-height:1.45; }

.dlg-leaf { position:relative; padding:0 14px 0 32px; }
.dlg-leaf::before {
  content:""; position:absolute; left:18px; top:0; bottom:0; width:1px; background:var(--edge-soft);
}
.dlg-leaf.tip::before { bottom:auto; height:19px; }
.dlg-leaf::after {
  content:""; position:absolute; left:18px; top:19px; width:9px; height:1px; background:var(--edge-soft);
}
.dlg-lrow {
  display:flex; align-items:flex-start; gap:8px; width:100%; text-align:left;
  background:none; border:0; padding:9px 0; cursor:pointer; font-family:inherit; color:var(--ink);
  border-bottom:1px solid var(--edge-soft);
}
.dlg-lrow:focus-visible { outline:2px solid var(--peri-ink); outline-offset:-2px; }
.dlg-lname { font-size:14.5px; font-weight:600; line-height:1.35; }
.dlg-lwhat { font-size:12.5px; color:var(--muted); line-height:1.45; margin-top:2px; }
.dlg-dot { width:8px; height:8px; border-radius:99px; flex:none; margin-top:6px; }
.dlg-dot.full { background:var(--sage); }
.dlg-dot.differs { background:var(--butter); }
.dlg-dot.none { background:var(--rose); }
.dlg-dot.na { background:var(--edge); }
.dlg-tagpill {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:9px; letter-spacing:.09em;
  text-transform:uppercase; font-weight:700; padding:2px 6px; border-radius:4px;
  background:var(--butter-soft); color:var(--butter-ink); margin-left:6px; vertical-align:2px;
}
.dlg-lbody { padding:2px 0 14px; border-bottom:1px solid var(--edge-soft); }
.dlg-rule {
  font-family:ui-monospace,Menlo,monospace; font-size:12px; line-height:1.6; white-space:pre-wrap;
  background:var(--peri-soft); color:var(--peri-ink); padding:9px 11px; border-radius:8px;
  overflow-x:auto; margin-bottom:9px;
}
.dlg-ex {
  font-family:ui-monospace,Menlo,monospace; font-size:12.5px; line-height:1.6; white-space:pre-wrap;
  background:var(--canvas); color:var(--ink); padding:9px 11px; border-radius:8px;
  border:1px solid var(--edge-soft); overflow-x:auto; margin-bottom:10px;
}
.dlg-matrix { display:flex; flex-direction:column; gap:5px; }
.dlg-mrow { display:flex; align-items:flex-start; gap:8px; font-size:12.5px; line-height:1.45; }
.dlg-mname {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:11px; font-weight:700;
  width:82px; flex:none; color:var(--muted); padding-top:1px;
}
.dlg-mname.focus { color:var(--ink); }
.dlg-mnote { color:var(--muted); }
.dlg-msay {
  font-family:ui-sans-serif,system-ui,sans-serif; font-size:11px; font-weight:600;
  padding:1px 6px; border-radius:4px; flex:none;
}
.dlg-msay.full { background:var(--sage-soft); color:var(--sage-ink); }
.dlg-msay.differs { background:var(--butter-soft); color:var(--butter-ink); }
.dlg-msay.none { background:var(--rose-soft); color:var(--rose-ink); }
.dlg-empty-doc { padding:26px 16px; text-align:center; color:var(--muted); font-size:14px; }
.dlg-toolbar { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
.dlg-search {
  flex:1; min-width:150px; font-family:ui-sans-serif,system-ui,sans-serif; font-size:14px;
  padding:9px 12px; border-radius:10px; border:1px solid var(--edge);
  background:var(--paper); color:var(--ink);
}
.dlg-search:focus-visible { outline:2px solid var(--peri-ink); outline-offset:1px; }
.dlg-shake { animation:dlgshake .32s; }
@keyframes dlgshake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }
@media (prefers-reduced-motion:reduce) {
  .dlg-shake { animation:none; }
  .dlg *, .dlg *::before { transition:none !important; }
}
`;

/* ---------------- reference doc ------------------------------------- */

const SAY = { full: "supported", differs: "differs", none: "not supported" };

function Leaf({ leaf, dialect, noMatrix, isTip }) {
  const [open, setOpen] = useState(false);
  const level = noMatrix ? "na" : leaf.support[dialect];

  return (
    <div className={`dlg-leaf ${isTip && !open ? "tip" : ""}`}>
      <button className="dlg-lrow" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`dlg-dot ${level}`} title={noMatrix ? "" : SAY[level]} />
        <span style={{ flex: 1 }}>
          <span className="dlg-lname">
            {leaf.name}
            {leaf.tag && <span className="dlg-tagpill">{leaf.tag}</span>}
          </span>
          {!open && <span className="dlg-lwhat" style={{ display: "block" }}>{leaf.what}</span>}
        </span>
        <span className={`dlg-caret ${open ? "open" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="dlg-lbody">
          <div className="dlg-lwhat" style={{ fontSize: 13.5, marginBottom: 10 }}>{leaf.what}</div>
          <div className="dlg-label" style={{ marginBottom: 4 }}>Rule</div>
          <div className="dlg-rule">{leaf.rule}</div>
          {leaf.example && (
            <>
              <div className="dlg-label" style={{ marginBottom: 4 }}>Example</div>
              <div className="dlg-ex">{leaf.example}</div>
            </>
          )}
          {!noMatrix && (
            <>
              <div className="dlg-label" style={{ marginBottom: 6 }}>Across dialects</div>
              <div className="dlg-matrix">
                {DIALECT_NAMES.map((d) => (
                  <div className="dlg-mrow" key={d}>
                    <span className={`dlg-mname ${d === dialect ? "focus" : ""}`}>{d}</span>
                    <span className={`dlg-msay ${leaf.support[d]}`}>{SAY[leaf.support[d]]}</span>
                    {leaf.notes && leaf.notes[d] && <span className="dlg-mnote">{leaf.notes[d]}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
          {noMatrix && leaf.notes && leaf.notes.DuckDB && (
            <div className="dlg-mnote" style={{ fontSize: 13 }}>{leaf.notes.DuckDB}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ReferenceDoc({ dialect }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | yes | no
  const [open, setOpen] = useState(() => ({ "b-stmt": true }));

  const q = query.trim().toLowerCase();

  const branches = useMemo(() => {
    return GRAMMAR.map((b) => {
      const leaves = b.leaves.filter((l) => {
        if (q) {
          const hay = `${l.name} ${l.what} ${l.rule} ${l.example || ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (filter !== "all" && !b.noMatrix) {
          const lvl = l.support[dialect];
          if (filter === "yes" && lvl !== "full") return false;
          if (filter === "no" && lvl === "full") return false;
        }
        if (filter !== "all" && b.noMatrix) return false;
        return true;
      });
      return { ...b, leaves };
    }).filter((b) => b.leaves.length > 0);
  }, [q, filter, dialect]);

  const total = branches.reduce((n, b) => n + b.leaves.length, 0);
  const searching = q.length > 0;

  return (
    <>
      <div className="dlg-toolbar">
        <input
          className="dlg-search"
          value={query}
          placeholder="Search rules…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="dlg-btn ghost" onClick={() => setQuery("")}>Clear</button>
        )}
      </div>

      <div className="dlg-toolbar" style={{ marginBottom: 12 }}>
        {[["all", "Everything"], ["yes", `In ${dialect}`], ["no", `Missing or different`]].map(([k, label]) => (
          <button key={k} className="dlg-tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="dlg-doc">
        <div className="dlg-trunk">
          <h2 className="dlg-trunk-name">{dialect === "DuckDB" ? "DuckSQL" : dialect}</h2>
          <p className="dlg-trunk-gloss">
            {total} rules across {branches.length} {branches.length === 1 ? "branch" : "branches"}.
            Green means this dialect supports the rule as written, amber that it says the same thing
            another way, red that it has no equivalent.
          </p>
        </div>

        <div className="dlg-scrollpane">
          {branches.length === 0 && (
            <div className="dlg-empty-doc">
              Nothing matches that. Try a shorter search, or widen the filter.
            </div>
          )}

          {branches.map((b) => {
            const isOpen = searching || open[b.id];
            return (
              <div key={b.id}>
                <button
                  className="dlg-bhead"
                  aria-expanded={isOpen}
                  onClick={() => setOpen({ ...open, [b.id]: !isOpen })}
                >
                  <span className="dlg-node" />
                  <span className="dlg-bname">{b.branch}</span>
                  <span className="dlg-count">{b.leaves.length}</span>
                  <span className={`dlg-caret ${isOpen ? "open" : ""}`}>▸</span>
                </button>
                {isOpen && (
                  <>
                    <div className="dlg-bgloss">{b.gloss}</div>
                    {b.leaves.map((l, i) => (
                      <Leaf
                        key={l.name}
                        leaf={l}
                        dialect={dialect}
                        noMatrix={b.noMatrix}
                        isTip={i === b.leaves.length - 1}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--faint)", lineHeight: 1.5, margin: "12px 2px 0" }}>
        Written as a study aid, not as a specification. Version-specific behaviour moves —
        check each project's own documentation before you rely on it.
      </p>
    </>
  );
}

/* ---------------- component ---------------------------------------- */

export default function DialectSQLGame() {
  const [tab, setTab] = useState("play");
  const [dialect, setDialect] = useState("DuckDB");
  const [idx, setIdx] = useState(0);
  const [built, setBuilt] = useState([]);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState("chips");
  const [state, setState] = useState("open"); // open | wrong | right
  const [showHint, setShowHint] = useState(false);
  const [misses, setMisses] = useState(0);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [done, setDone] = useState(false);
  const shakeRef = useRef(null);

  const deck = useMemo(
    () => LESSONS.filter((l) => l.flavour === "core" || dialect === "DuckDB"),
    [dialect]
  );

  const lesson = deck[Math.min(idx, deck.length - 1)];

  const bank = useMemo(
    () =>
      seededShuffle(
        lesson.bank.map((label, i) => ({ id: `${lesson.id}-${i}`, label })),
        hash(lesson.id)
      ),
    [lesson]
  );

  // reset when the deck changes underneath us
  useEffect(() => {
    setIdx(0); reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialect]);

  function reset() {
    setBuilt([]); setTyped(""); setState("open"); setShowHint(false); setMisses(0);
  }

  const currentTokens = mode === "chips"
    ? tokenize(built.map((b) => b.label).join(" "))
    : tokenize(typed);

  const clauses = useMemo(() => {
    const target = normalize(tokenize(lesson.answers[0]));
    const wanted = ["SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT", "JOIN", "ON"];
    return wanted.filter((w) => target.includes(w))
      .map((w) => (w === "GROUP" ? "GROUP BY" : w === "ORDER" ? "ORDER BY" : w));
  }, [lesson]);

  const litClauses = useMemo(() => {
    const cur = normalize(currentTokens);
    return new Set(clauses.filter((c) => cur.includes(c.split(" ")[0])));
  }, [currentTokens, clauses]);

  function check() {
    const ok = lesson.answers.some((a) => sameQuery(currentTokens, tokenize(a)));
    if (ok) {
      setState("right");
      setXp((x) => x + (misses === 0 && !showHint ? 12 : 6));
      setStreak((s) => s + 1);
    } else {
      setState("wrong");
      setMisses((m) => m + 1);
      setStreak(0);
      if (shakeRef.current) {
        shakeRef.current.classList.remove("dlg-shake");
        void shakeRef.current.offsetWidth;
        shakeRef.current.classList.add("dlg-shake");
      }
    }
  }

  function next() {
    if (idx + 1 >= deck.length) { setDone(true); return; }
    setIdx(idx + 1);
    reset();
  }

  function restart() {
    setDone(false); setIdx(0); setXp(0); setStreak(0); reset();
  }

  const usedIds = new Set(built.map((b) => b.id));
  const canCheck = mode === "chips" ? built.length > 0 : typed.trim().length > 0;

  /* ---------- reference view ---------- */
  const reference = (
    <>
      <div className="dlg-card">
        <div className="dlg-label" style={{ marginBottom: 10 }}>The tables you are querying</div>
        {SCHEMA.map((t) => (
          <div key={t.name} style={{ marginBottom: 18 }}>
            <div className="dlg-mono" style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t.name}</div>
            <div className="dlg-scroll">
              <table className="dlg-tbl">
                <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {t.rows.map((r, i) => (
                    <tr key={i}>{r.map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="dlg-card">
        <h2 className="dlg-h">Phrasebook</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 14px" }}>
          The same idea, said four ways. Dialects differ most at the edges — string handling,
          row limits, and whatever shorthand each system invented for itself.
        </p>
        {[
          ["All columns", { DuckDB: "FROM t; or SELECT * FROM t;", PostgreSQL: "SELECT * FROM t;", SQLite: "SELECT * FROM t;", MySQL: "SELECT * FROM t;" }],
          ["First 3 rows", { DuckDB: "LIMIT 3", PostgreSQL: "LIMIT 3 / FETCH FIRST 3 ROWS ONLY", SQLite: "LIMIT 3", MySQL: "LIMIT 3" }],
          ["Join two strings", { DuckDB: "a || b", PostgreSQL: "a || b", SQLite: "a || b", MySQL: "CONCAT(a, b)" }],
          ["Group by everything selected", { DuckDB: "GROUP BY ALL", PostgreSQL: "list the columns", SQLite: "list the columns", MySQL: "list the columns" }],
          ["Drop one column from *", { DuckDB: "SELECT * EXCLUDE (c)", PostgreSQL: "list the columns", SQLite: "list the columns", MySQL: "list the columns" }],
          ["Name a column", { DuckDB: "expr AS n, or n: expr", PostgreSQL: "expr AS n", SQLite: "expr AS n", MySQL: "expr AS n" }],
          ["Current date", { DuckDB: "current_date", PostgreSQL: "current_date", SQLite: "date('now')", MySQL: "curdate()" }],
        ].map(([title, rowmap]) => (
          <div key={title} style={{ marginBottom: 14 }}>
            <div className="dlg-label" style={{ color: "var(--ink)", marginBottom: 4 }}>{title}</div>
            <div className="dlg-phrase">
              {DIALECT_NAMES.map((d) => (
                <React.Fragment key={d}>
                  <div className="dlg-dname">{d}</div>
                  <div className="dlg-dtext"><code>{rowmap[d]}</code></div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  /* ---------- finished ---------- */
  const finished = (
    <div className="dlg-card" style={{ textAlign: "center", padding: "34px 20px" }}>
      <div className="dlg-label" style={{ marginBottom: 8 }}>Deck complete</div>
      <h2 style={{ fontSize: 26, margin: "0 0 6px", fontWeight: 600 }}>
        {deck.length} sentences, spoken fluently
      </h2>
      <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.5, margin: "0 0 20px" }}>
        You finished with <b style={{ color: "var(--peri-ink)" }}>{xp} XP</b> in {dialect}.
        Switch dialects to see which sentences stop working.
      </p>
      <button className="dlg-btn primary" onClick={restart}>Run it again</button>
    </div>
  );

  return (
    <div className="dlg">
      <style>{CSS}</style>
      <div className="dlg-wrap">

        <div className="dlg-top">
          <h1 className="dlg-title">Dialect</h1>
          <div className="dlg-score">
            <b>{xp}</b> xp{streak > 1 ? ` · ${streak} in a row` : ""}
          </div>
        </div>
        <p className="dlg-sub">Learn SQL the way you'd learn a language — vocabulary, word order, accents.</p>

        <div className="dlg-tabs">
          <button className="dlg-tab" aria-selected={tab === "play"} onClick={() => setTab("play")}>Practice</button>
          <button className="dlg-tab" aria-selected={tab === "ref"} onClick={() => setTab("ref")}>Phrasebook</button>
          <button className="dlg-tab" aria-selected={tab === "doc"} onClick={() => setTab("doc")}>Reference</button>
        </div>

        {/* dialect picker */}
        <div className="dlg-card" style={{ padding: "12px 14px", marginBottom: 14 }}>
          <div className="dlg-label" style={{ marginBottom: 8 }}>Speaking</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DIALECT_NAMES.map((d) => (
              <button
                key={d}
                className="dlg-tab"
                aria-selected={dialect === d}
                onClick={() => { setDialect(d); setDone(false); }}
              >{d}</button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "9px 0 0", lineHeight: 1.45 }}>
            {tab === "doc"
              ? `The reference is scored against ${dialect}. Switch to see the same rules re-marked.`
              : tab === "ref"
              ? "The phrasebook always shows all four side by side."
              : dialect === "DuckDB"
              ? "Full deck: core SQL plus DuckDB's own shorthand."
              : `Core SQL only — ${LESSONS.length - deck.length} DuckDB-specific lessons are hidden, because they would not parse here.`}
          </p>
        </div>

        {tab === "doc" ? <ReferenceDoc dialect={dialect} /> : tab === "ref" ? reference : done ? finished : (
          <>
            <div className="dlg-ticks" aria-hidden="true">
              {deck.map((l, i) => (
                <div key={l.id} className={`dlg-tick ${i < idx ? "done" : i === idx ? "now" : ""}`} />
              ))}
            </div>

            <div className="dlg-card" ref={shakeRef}>
              <div className="dlg-eyebrow">
                <span className={`dlg-badge ${lesson.flavour === "duckdb" ? "duck" : "core"}`}>
                  {lesson.flavour === "duckdb" ? "DuckDB only" : "Core SQL"}
                </span>
                <span className="dlg-label">{lesson.unit} · {idx + 1} of {deck.length}</span>
              </div>

              <p className="dlg-prompt">{lesson.prompt}</p>

              {/* answer slate */}
              {mode === "chips" ? (
                <div className="dlg-slate">
                  <div className="dlg-line">
                    {built.length === 0 && <span className="dlg-empty">Tap words below to build the sentence…</span>}
                    {built.map((b, i) => (
                      <button
                        key={b.id}
                        className={`dlg-chip ${chipPos(b.label)}`}
                        onClick={() => state !== "right" && setBuilt(built.filter((_, j) => j !== i))}
                      >{b.label}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <textarea
                    className="dlg-input"
                    value={typed}
                    spellCheck={false}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="Type the query…"
                  />
                </div>
              )}

              {/* clause rail */}
              {clauses.length > 0 && (
                <div className="dlg-rail">
                  {clauses.map((c, i) => (
                    <React.Fragment key={c + i}>
                      {i > 0 && <div className="dlg-rail-bar" />}
                      <div className="dlg-rail-seg">
                        <div className={`dlg-rail-dot ${litClauses.has(c) ? "lit" : ""}`} />
                        <div className={`dlg-rail-name ${litClauses.has(c) ? "lit" : ""}`}>{c}</div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* bank */}
              {mode === "chips" && state !== "right" && (
                <div className="dlg-bank">
                  {bank.map((b) => (
                    <button
                      key={b.id}
                      disabled={usedIds.has(b.id)}
                      className={`dlg-chip ${chipPos(b.label)} ${usedIds.has(b.id) ? "spent" : ""}`}
                      onClick={() => !usedIds.has(b.id) && setBuilt([...built, b])}
                    >{b.label}</button>
                  ))}
                </div>
              )}

              {/* feedback */}
              {state === "wrong" && (
                <div className="dlg-note bad">
                  Not quite — that word order doesn't parse. Reorder or swap a word and check again.
                </div>
              )}
              {showHint && state !== "right" && (
                <div className="dlg-note tip">{lesson.hint}</div>
              )}
              {state === "right" && (
                <>
                  <div className="dlg-note good">{lesson.explain}</div>
                  <div style={{ marginTop: 16 }}>
                    <div className="dlg-label" style={{ marginBottom: 6 }}>Result</div>
                    <div className="dlg-scroll">
                      <table className="dlg-tbl">
                        <thead><tr>{lesson.result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>
                          {lesson.result.rows.map((r, i) => (
                            <tr key={i}>
                              {r.map((v, j) => (
                                <td key={j} className={v === null ? "null" : ""}>{cell(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* actions */}
              <div className="dlg-actions">
                {state === "right" ? (
                  <button className="dlg-btn go" onClick={next}>
                    {idx + 1 >= deck.length ? "Finish" : "Next sentence"}
                  </button>
                ) : (
                  <>
                    <button className="dlg-btn primary" onClick={check} disabled={!canCheck}>Check</button>
                    <button className="dlg-btn ghost" onClick={() => setShowHint(true)}>Hint</button>
                    <button className="dlg-btn ghost" onClick={reset}>Clear</button>
                    <button
                      className="dlg-btn ghost"
                      onClick={() => { setMode(mode === "chips" ? "type" : "chips"); setBuilt([]); setTyped(""); setState("open"); }}
                    >{mode === "chips" ? "Type it instead" : "Use word bank"}</button>
                  </>
                )}
              </div>

              {mode === "chips" && state !== "right" && (
                <div className="dlg-legend">
                  {[["kw", "keyword", "var(--peri)"], ["id", "table or column", "var(--sage)"],
                    ["op", "operator", "var(--lilac)"], ["val", "value", "var(--butter)"]].map(([k, label, col]) => (
                    <div className="dlg-leg" key={k}>
                      <span className="dlg-swatch" style={{ background: col }} />
                      <span className="dlg-label" style={{ letterSpacing: ".06em" }}>{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* phrasebook for this sentence */}
            {state === "right" && (
              <div className="dlg-card">
                <div className="dlg-label" style={{ marginBottom: 2 }}>Elsewhere, the same sentence</div>
                <div className="dlg-phrase">
                  {DIALECT_NAMES.map((d) => (
                    <React.Fragment key={d}>
                      <div className="dlg-dname" style={d === dialect ? { color: "var(--ink)" } : undefined}>{d}</div>
                      <div className="dlg-dtext">{lesson.dialects[d]}</div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
