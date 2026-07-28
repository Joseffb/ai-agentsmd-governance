import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function profilePath() {
  return path.resolve(
    process.env.ACG_MACHINE_PROFILE
      ?? path.join(os.homedir(), ".codex", "governance-machine-profile.json")
  );
}

function readProfile(file) {
  if (!fs.existsSync(file)) {
    return { schema_version: 1 };
  }
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Machine profile must contain a JSON object: ${file}`);
  }
  return value;
}

function writeProfile(file, profile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

function requireAuthorizedOptions(options) {
  if (!options.authorizeProfileWrite) {
    throw new Error("Profile write requires --authorize-profile-write");
  }
  if (!options.project) {
    throw new Error("Profile write requires --project <slug>");
  }
  if (!options.root || !path.isAbsolute(options.root)) {
    throw new Error("Profile write requires --path <absolute-path>");
  }
}

function updateReadRoot(options, remove) {
  requireAuthorizedOptions(options);
  const file = profilePath();
  const profile = readProfile(file);
  const projectRoots = {
    ...(profile.project_read_roots && typeof profile.project_read_roots === "object"
      ? profile.project_read_roots
      : {})
  };
  const root = path.resolve(options.root);
  const current = Array.isArray(projectRoots[options.project])
    ? projectRoots[options.project].map((entry) => path.resolve(entry))
    : [];
  const next = remove
    ? current.filter((entry) => entry !== root)
    : [...new Set([...current, root])].sort();

  if (next.length > 0) {
    projectRoots[options.project] = next;
  } else {
    delete projectRoots[options.project];
  }

  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (changed) {
    profile.project_read_roots = projectRoots;
    writeProfile(file, profile);
  }

  return {
    profile_path: file,
    project: options.project,
    path: root,
    capability: "read_only",
    operation: remove ? "remove" : "add",
    changed
  };
}

export function addMachineProjectReadRoot(options) {
  return updateReadRoot(options, false);
}

export function removeMachineProjectReadRoot(options) {
  return updateReadRoot(options, true);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function handleReadRootProfileCommand(args) {
  if (args[0] !== "profile" || !["add-read-root", "remove-read-root"].includes(args[1])) {
    return false;
  }
  if (args.includes("--help")) {
    process.stdout.write(
      `Usage: acg profile ${args[1]} --project <slug> --path <absolute-path> --authorize-profile-write\n`
    );
    return true;
  }
  const options = {
    project: optionValue(args, "--project"),
    root: optionValue(args, "--path"),
    authorizeProfileWrite: args.includes("--authorize-profile-write")
  };
  const result = args[1] === "add-read-root"
    ? addMachineProjectReadRoot(options)
    : removeMachineProjectReadRoot(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return true;
}
