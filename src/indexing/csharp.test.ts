import { describe, expect, it } from "vitest";
import { extractFileGraph } from "./symbolGraph.js";
import { createDependencyResolver } from "./dependencyResolver.js";
import { classifyRelatedPath } from "./relatedFiles.js";

function projectDependencies(content: string, files: string[] = ["src/Api/Api.csproj", "src/Core/Core.csproj"]) {
  const graph = extractFileGraph("src/Api/Api.csproj", content);
  const resolve = createDependencyResolver(new Set(files), new Map());
  return graph.dependencies.map((dependency) => ({ ...dependency, paths: resolve("src/Api/Api.csproj", dependency) }));
}

describe("C# structure extraction", () => {
  it("reads nested and file-scoped namespaces and public, partial, and record types", () => {
    const graph = extractFileGraph("Types.cs", [
      "namespace Shop {", "namespace Core {", "public partial class Validator<T> { }",
      "public interface IValidator { bool ValidateToken(string token); }",
      "public readonly record struct Session(string Id);", "internal enum State { Ready }", "}", "}",
    ].join("\n"));
    expect(graph.symbols.map(({ name, kind, line, exported }) => ({ name, kind, line, exported }))).toEqual([
      { name: "Shop", kind: "namespace", line: 1, exported: false },
      { name: "Shop.Core", kind: "namespace", line: 2, exported: false },
      { name: "Validator", kind: "class", line: 3, exported: true },
      { name: "IValidator", kind: "interface", line: 4, exported: true },
      { name: "ValidateToken", kind: "method", line: 4, exported: true },
      { name: "Session", kind: "record", line: 5, exported: true },
      { name: "State", kind: "enum", line: 6, exported: false },
    ]);
    expect(extractFileGraph("File.cs", "namespace Shop.Core;\npublic struct Token {}\n").symbols).toContainEqual(expect.objectContaining({ name: "Shop.Core", kind: "namespace", line: 1 }));
  });

  it("distinguishes generic, multiline, and constructor declarations from calls and properties", () => {
    const graph = extractFileGraph("Validator.cs", [
      "public class Validator {",
      "  public Validator() {}",
      "  [Obsolete]",
      "  public async Task<Result<T>> ValidateAsync<T>(",
      "    T token) where T : class { return default!; }",
      "  private bool Hidden() => true;",
      "  public string Name { get; set; }",
      "  public object Factory = Make();",
      "  void Execute() {",
      "    ValidateAsync<string>(\"example\");",
      "    static bool Local() => true;",
      "  }",
      "}",
    ].join("\n"));
    expect(graph.symbols.filter((symbol) => symbol.kind === "method").map(({ name, line, exported }) => ({ name, line, exported }))).toEqual([
      { name: "Validator", line: 2, exported: true }, { name: "ValidateAsync", line: 4, exported: true },
      { name: "Hidden", line: 6, exported: false }, { name: "Execute", line: 9, exported: false },
    ]);
  });

  it("preserves namespace using hints without resolving them as file imports", () => {
    const graph = extractFileGraph("App.cs", [
      "global using System;", "using static System.Math;", "using Alias = global::Shop.Core;", "namespace Shop {",
      "using Shop.Core;", "public class App { void Run() { using var file = Open(); } }", "}",
    ].join("\n"));
    expect(graph.dependencies).toEqual([
      { specifier: "System", line: 1, kind: "unresolved" }, { specifier: "System.Math", line: 2, kind: "unresolved" },
      { specifier: "global::Shop.Core", line: 3, kind: "unresolved" }, { specifier: "Shop.Core", line: 5, kind: "unresolved" },
    ]);
    const resolve = createDependencyResolver(new Set(["Shop/Core.cs", "Shop/Core.csproj"]), new Map());
    expect(graph.dependencies.flatMap((dependency) => resolve("App.cs", dependency))).toEqual([]);
  });

  it("keeps physical declaration lines across preprocessor directives without choosing a build configuration", () => {
    const graph = extractFileGraph("Editor.cs", "class Editor {\n#if UNITY_EDITOR\npublic void Inspect() {}\n#else\npublic void Run() {}\n#endif\n}");
    expect(graph.symbols.filter((symbol) => symbol.kind === "method")).toEqual([
      expect.objectContaining({ name: "Inspect", line: 3 }), expect.objectContaining({ name: "Run", line: 5 }),
    ]);
  });

  it("does not discover phantom declarations in comments and ordinary, verbatim, or raw strings", () => {
    const source = '// namespace Fake;\n/* public class Phantom {} */\nclass Real {\n string normal = "class Fake {}";\n string verbatim = @"namespace Fake { using Wrong; }";\n string raw = """\n public class Fake {}\n using Wrong;\n """;\n public void @Run() {}\n}\n';
    const graph = extractFileGraph("Real.cs", source);
    expect(graph.symbols.map((symbol) => symbol.name)).toEqual(["Real", "Run"]);
    expect(graph.dependencies).toEqual([]);
  });
});

describe("C# test file roles", () => {
  it.each(["src/TokenValidatorTests.cs", "src/TokenTest.cs", "Shop.Tests/Token.cs", "Shop.UnitTests/Token.cs", "Shop.Tests.csproj"])("recognizes %s", (file) => {
    expect(classifyRelatedPath(file)).toBe("test");
  });
  it("does not classify Contest.cs as a test file", () => {
    expect(classifyRelatedPath("src/Contest.cs")).toBe("source");
  });
});

describe("C# literal project references", () => {
  it("reads multiline Windows paths, XML namespaces, and source line numbers", () => {
    expect(projectDependencies('<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n  <ItemGroup>\n    <ProjectReference\n       Include="..\\Core\\Core.csproj" />\n  </ItemGroup>\n</Project>')).toEqual([
      { specifier: "..\\Core\\Core.csproj", line: 3, paths: ["src/Core/Core.csproj"] },
    ]);
  });

  it("keeps references under conditions and build targets unresolved", () => {
    for (const source of [
      '<Project><ItemGroup Condition="\'$(TargetFramework)\' == \'net10.0\'"><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Project>',
      '<Project><ItemGroup><ProjectReference Include="../Core/Core.csproj" Condition="true" /></ItemGroup></Project>',
      '<Project><Choose><Otherwise><ItemGroup><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Otherwise></Choose></Project>',
      '<Project><Target Name="Build"><ItemGroup><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Target></Project>',
    ]) expect(projectDependencies(source)).toMatchObject([{ kind: "unresolved", paths: [] }]);
  });

  it.each(["$(CorePath)/Core.csproj", "../*/Core.csproj", "../Core/Core.csproj;../Other/Other.csproj", "../../../../private/Core.csproj", "/absolute/Core.csproj", "C:\\private\\Core.csproj", "../Missing/Missing.csproj", "../Core/%43ore.csproj"])("does not guess dynamic, excluded, missing, or outside-root references: %s", (include) => {
    expect(projectDependencies(`<Project><ItemGroup><ProjectReference Include="${include}" /></ItemGroup></Project>`)[0].paths).toEqual([]);
  });

  it("ignores comments/CDATA and respects explicit removal without loading XML entities", () => {
    const source = '<Project>\n<!-- <ProjectReference Include="../Core/Core.csproj" /> -->\n<![CDATA[<ProjectReference Include="../Core/Core.csproj" />]]>\n<ItemGroup>\n<ProjectReference Include="../Core/./Core.csproj" />\n<ProjectReference Remove="../Core/Core.csproj" />\n<ProjectReference Include="&external;/Core.csproj" />\n</ItemGroup></Project>';
    expect(projectDependencies(source)).toMatchObject([
      { specifier: "../Core/./Core.csproj", kind: "unresolved", line: 5, paths: [] },
      { specifier: "&external;/Core.csproj", paths: [] },
    ]);
  });

  it("keeps a reference unresolved when its target is excluded from the index", () => {
    expect(projectDependencies('<Project><ItemGroup><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Project>', ["src/Api/Api.csproj"])).toMatchObject([{ paths: [] }]);
  });

  it("decodes standard XML character references in literal paths", () => {
    const source = '<Project><ItemGroup><ProjectReference Include="../Core&amp;Shared/Core.csproj" /></ItemGroup></Project>';
    expect(projectDependencies(source, ["src/Api/Api.csproj", "src/Core&Shared/Core.csproj"])).toEqual([
      { specifier: "../Core&Shared/Core.csproj", line: 1, paths: ["src/Core&Shared/Core.csproj"] },
    ]);
  });
});
