# Releasing satchel-nft

The npm package `satchel-nft` is published by its owner, from the owner's npm account, without npm
provenance. npm records the commit as `gitHead`:

| Version | Published | `gitHead` | `dist.shasum` |
| --- | --- | --- | --- |
| 0.1.0 | 2026-11-09 | `728ed74` | `599980b6445558157e28f7bae7872b0756988150` |
| 0.2.0 | 2026-11-10 | `2dd4209` | `b9822a7ac13476566bc6772ccda08979e5802480` |
| 0.3.0 | 2026-11-14 | `63f1fd7` | `ddbb4a26b3b5f6b77237faa9a9ad47c0155f6025` |
| 0.3.1 | 2026-11-14 | `cfa0d29` | `1e8db4a1dca27b452a90179347332cb97e1c1896` |

This is the checklist 0.2.0 went through. The package's README, which npm shows, says what changed
under "What changed in 0.2.0". For a later version, bump `packages/satchel-nft/package.json` and its
lockfile entry in a pull request, then follow the same steps with that version in place of 0.2.0,
and 0.2.0 in place of 0.1.0. Until the new version is on npm, every pinned command keeps the version
npm serves. Between releases the checkout's package carries a `-dev` version (`0.3.0-dev` before
0.3.0), so no clone calls unreleased code by a released version: the release's pull request drops
the `-dev`, and the pull request that moves the pins after the publish sets the next one
(`0.4.0-dev`). A patch from a `-dev` checkout works the same way: its pull request sets the patch
version (`0.4.0-dev` to `0.3.1`), and the pull request after the publish sets `0.4.0-dev` again.

## 1. Pick the commit

Publish from a commit on `main` whose `packages/satchel-nft/package.json` says `0.2.0`:

```bash
git fetch origin
git show origin/main:packages/satchel-nft/package.json | grep '"version"'
git rev-parse origin/main
```

The last line prints the commit that steps 2 and 4 use.

## 2. Check it in a clean clone

`.gitattributes` keeps the package's files LF in every checkout, so a Windows clone packs the same
file contents as CI's Linux one.

```bash
git clone https://github.com/duongnq2798/satchel.git satchel-release
cd satchel-release
git checkout <commit>
npm ci
npm run typecheck -w satchel-nft
npm test -w satchel-nft
npm pack -w satchel-nft --dry-run
```

The dry run must list only `bin/satchel-nft.js`, `dist/…`, `README.md`, `LICENSE` and
`package.json`, as CI's package workflow checks.

## 3. Publish (the owner)

From the same folder, signed in to npm as the package's owner:

```bash
npm publish -w satchel-nft
```

`prepack` builds `dist` from the checkout first.

The owner's account has two-factor authentication for writes, confirmed in the browser. npm 11
offers that only when it runs in a real console, such as PowerShell. Git Bash's terminal isn't one
to npm, so there `npm publish` stops with `EOTP` and asks for an authenticator code instead.

## 4. Check what npm holds

```bash
npm view satchel-nft@0.2.0 gitHead dist.shasum
```

`gitHead` must be the commit from step 1. On the machine that published, `npm pack -w satchel-nft`
in the release folder gives the same shasum.

Then run the published package from an empty folder outside any checkout, with a cache of its own.
Inside a clone at the release commit, npx runs the clone's own build, which prints `0.2.0` whether
or not the publish worked:

```bash
cd "$(mktemp -d)"
npx --cache "$PWD/npx-cache" -y satchel-nft@0.2.0 --version
npx --cache "$PWD/npx-cache" -y satchel-nft@0.2.0 verify --network mainnet 1; echo "exit $?"
```

The first prints `0.2.0`. The second ends with `PROVABLY CLEAN` and `exit 0`. Before the publish,
the same first command fails with `ETARGET`.

## 5. Move the pins

Then, in one pull request into `dev`, change every place that names 0.1.0 as the version to run or
as the current release, or says a feature comes "with the next release". These searches list them;
read the lines around each hit too, since a sentence can wrap past the line that matches:

```bash
git grep -n 'satchel-nft@0\.1\.0' -- ':!packages/satchel-nft'
git grep -n -i -e '0\.1\.0' -e '728ed74' -e '599980b6' -e 'on npm yet' -e 'next npm release' -e 'next release' -- ':!package-lock.json' ':!CHANGELOG.md' ':!contracts' ':!deployments' ':!packages/satchel-nft'
```

These stay as they are: the contract's own version in `contracts/`, the MPC derivation's
`near-mpc-recovery v0.1.0`, the run records in `deployments/`, and the CHANGELOG's history.
`packages/satchel-nft` is left out of the searches: its README and code go into the next tarball,
and every change to them after a publish is listed under Unreleased in the CHANGELOG until that
version is out. The handover kit (`packages/satchel-nft/src/kit.ts`) and `fixPlan`'s terminal note
(`clean.ts`) pin an earlier release that has every command they print: `satchel-nft@0.3.0` since
0.3.1, where npm's 0.3.0 pins 0.2.0 and npm's 0.2.0 pins 0.1.0. A release's pull request can move
them to the newest version on npm.

- Every `satchel-nft@0.1.0` command becomes `satchel-nft@0.2.0`: the README, AGENTS.md,
  `docs/DEMO.md`, the docs under `web/content/docs`, the app's own pages (`web/src/app/page.tsx`,
  `web/src/app/mainnet/page.tsx`, `web/src/components/report-card.tsx`) and
  `.github/workflows/package.yml`, which runs the release from npm. Rename the production
  checklist's heading and the link to it (`#2-pin-satchel-nft010-and-check-it`) together.
- 0.1.0's npm facts become 0.2.0's, from step 4: the commit and shasum in `docs/THREAT_MODEL.md`'s
  npm entry and in the production checklist's `npm view` output; the commit in the README,
  AGENTS.md, `developers.mdx`, `developers/cli.mdx`, `security.mdx` and the production checklist's
  file comparison; printed versions such as `# 0.1.0` and "It prints `0.1.0`"; and `VERSIONS` in
  `web/src/app/docs/layout.tsx`.
- Notes that set 0.1.0 apart or point at the next release, such as "not in 0.1.0", "0.1.0 still
  reads…", "not on npm yet" and "from the next npm release", say "since 0.2.0", or go.
