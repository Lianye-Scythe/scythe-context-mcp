import { describe, expect, it } from "vitest";
import { extractFileGraph } from "./symbolGraph.js";
import { createDependencyResolver } from "./dependencyResolver.js";
import { classifyRelatedPath } from "./relatedFiles.js";

const graph = (text: string) => extractFileGraph("src/auth.cpp", text);

describe("basic C++ structure", () => {
  it("extracts namespaces, templates, types, declarations, methods, and physical lines", () => {
    const result = graph(`namespace shop::auth {
template <class T, typename U>
class Validator {
public:
  Validator();
  ~Validator() = default;
  bool validate_token(const T& token) const noexcept;
  virtual void reset() = 0;
};
struct Token {};
enum class Status { valid, invalid };
int count_tokens(
  const Token& token
) { return 1; }
}
bool shop::auth::Validator::validate_token(const Token& token) const { return true; }
`);
    expect(result.symbols.map(({ name, kind, line }) => ({ name, kind, line }))).toEqual([
      { name: "shop::auth", kind: "namespace", line: 1 },
      { name: "Validator", kind: "class", line: 3 },
      { name: "Validator", kind: "method", line: 5 },
      { name: "~Validator", kind: "method", line: 6 },
      { name: "validate_token", kind: "method", line: 7 },
      { name: "reset", kind: "method", line: 8 },
      { name: "Token", kind: "struct", line: 10 },
      { name: "Status", kind: "enum", line: 11 },
      { name: "count_tokens", kind: "function", line: 12 },
      { name: "validate_token", kind: "method", line: 16 },
    ]);
    expect(result.symbols[1].signature).toContain("template <class T, typename U>");
  });

  it("handles inline bodies, trailing returns, noexcept expressions, and forward declarations", () => {
    expect(graph(`class Forward;
struct Service {
public:
  auto value() const noexcept(true) -> int { return helper(); }
  void run() { helper(); if (ready()) { run_again(); } }
};
int free_function() { auto x = callback(); return x; }
`).symbols.map((s) => s.name)).toEqual(["Forward", "Service", "value", "run", "free_function"]);
  });

  it("ignores comments, string/raw-string contents, calls, and macro definitions", () => {
    const text = '// class Fake {};\n/* int fake(); */\nconst char* text = R"tag(\nclass Raw {};\n#include "phantom.h"\n)tag";\n#define DECLARE(x) class x {}; \\\nint macro_method();\nvoid run() { invoke(); }\n';
    expect(graph(text).symbols.map((s) => s.name)).toEqual(["run"]);
    expect(graph(text).dependencies).toEqual([]);
  });

  it("keeps physical line numbers and indexes both conditional branches", () => {
    expect(graph("#if FEATURE\nvoid enabled();\n#else\nvoid fallback();\n#endif\n").symbols.map((s) => [s.name, s.line])).toEqual([["enabled", 2], ["fallback", 4]]);
  });

  it("indexes anonymous namespace functions and qualified return types as functions", () => {
    expect(graph("namespace {\nstd::string token_name();\n}\n").symbols).toEqual([
      expect.objectContaining({ name: "token_name", kind: "function", line: 2 }),
    ]);
  });

  it.each(["file.cpp", "file.cc", "file.cxx", "file.h", "file.hpp", "file.hh", "file.hxx", "file.ipp", "file.tpp", "FILE.CPP"])("recognizes %s", (file) => {
    expect(extractFileGraph(file, "int validate_token();").symbols[0].name).toBe("validate_token");
  });
});

describe("local C++ includes", () => {
  it("preserves comment-like characters inside quoted header paths", () => {
    expect(graph('#include /* header */ "nested//auth.hpp" // trailing\n').dependencies).toEqual([
      { specifier: "nested//auth.hpp", line: 1, kind: "cpp_include" },
    ]);
  });
  it("does not extract include text inside a continued macro directive", () => {
    expect(graph('#define EXAMPLE \\\n#include "phantom.h"\n#include "actual.h"\n').dependencies).toEqual([
      { specifier: "actual.h", line: 3, kind: "cpp_include" },
    ]);
  });
  it("keeps literal, system, and macro includes with exact lines", () => {
    expect(graph('#include "auth.hpp" // local\n# include <vector>\n#include HEADER\n// #include "fake.h"\n').dependencies).toEqual([
      { specifier: "auth.hpp", line: 1, kind: "cpp_include" },
      { specifier: "vector", line: 2, kind: "unresolved" },
      { specifier: "HEADER", line: 3, kind: "unresolved" },
    ]);
  });

  it("only links exact quoted paths relative to the including file", () => {
    const resolve = createDependencyResolver(new Set(["src/auth.hpp", "include/auth.hpp", "common.h", "vector"]), new Map());
    const includes = graph('#include "auth.hpp"\n#include "../common.h"\n#include "missing.h"\n#include <vector>\n#include HEADER\n#include "../../../common.h"\n#include "auth"\n#include "/common.h"\n#include "C:\\auth.hpp"\n').dependencies;
    expect(includes.map((dep) => resolve("src/auth.cpp", dep))).toEqual([["src/auth.hpp"], ["common.h"], [], [], [], [], [], [], []]);
    expect(resolve("other/use.cpp", includes[0])).toEqual([]);
  });

  it.each(["src/auth_test.cpp", "src/auth_tests.cc", "src/TokenTests.cxx", "tests/use.hpp"])("classifies %s as test code", (file) => {
    expect(classifyRelatedPath(file)).toBe("test");
  });
  it("keeps ordinary source names classified as source", () => {
    expect(classifyRelatedPath("src/Contest.cpp")).toBe("source");
  });
});
