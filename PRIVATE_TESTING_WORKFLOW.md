# Private Testing Workflow

## Repository Architecture

**Public Repository**: `github.com/Michael-A-Kuykendall/shimmy`
- User-facing releases
- Stable, tested binaries only
- Documentation and issue tracking

**Private Repository**: `github.com/Michael-A-Kuykendall/shimmy-private`
- Pre-release testing
- Binary validation
- Breaking changes experimentation

## Git Remotes Setup

```bash
origin  → https://github.com/Michael-A-Kuykendall/shimmy.git (public)
private → https://github.com/Michael-A-Kuykendall/shimmy-private.git (private)
```

---

## Development Workflow

### Phase 1: Local Development
```bash
# Work on features locally
git checkout -b feature/kitchen-sink-binaries
# Make changes...
git commit -m "feat: implement Kitchen Sink architecture"
```

### Phase 2: Private Testing
```bash
# Push to private repo for CI/CD testing
git push private feature/kitchen-sink-binaries

# Create private pre-release tag
git tag v1.9.0-test
git push private v1.9.0-test

# GitHub Actions in private repo builds binaries
# Download and test binaries locally
gh release download v1.9.0-test --repo Michael-A-Kuykendall/shimmy-private
```

### Phase 3: Validate Binaries
```bash
# Test each binary
./shimmy-windows-x86_64.exe --version
./shimmy-windows-x86_64.exe serve --gpu-backend auto

# Run test suite against binaries
python scripts/test_binaries.py

# Check binary sizes
ls -lh shimmy-*
```

### Phase 4: Public Release (After Validation)
```bash
# Merge to main
git checkout main
git merge feature/kitchen-sink-binaries

# Push to public repo
git push origin main

# Create public release tag
git tag v1.9.0
git push origin v1.9.0

# GitHub Actions in public repo builds and publishes
# Binaries available to users
```

---

## Tag Strategy

### Private Tags (Testing)
```bash
v1.9.0-test
v1.9.0-test2
v1.9.0-rc1
```

Purpose: Test release process, validate binaries

### Public Tags (Production)
```bash
v1.9.0
v1.9.1
v2.0.0
```

Purpose: Stable releases for end users

---

## Release Checklist

### Private Pre-Release (shimmy-private)
- [ ] All local tests pass (`cargo test`)
- [ ] Release gates pass (`./scripts/release-gates.sh`)
- [ ] Create test tag (`v1.9.0-test`)
- [ ] Push to private: `git push private v1.9.0-test`
- [ ] Wait for CI/CD build (~30-45 min)
- [ ] Download binaries from private release
- [ ] Test each binary:
  - [ ] Linux x86_64: `--version`, `serve`, GPU detection
  - [ ] Windows x64: `--version`, `serve`, GPU detection
  - [ ] macOS ARM64: `--version`, `serve`, MLX detection
  - [ ] macOS Intel: `--version`, `serve`
  - [ ] Linux ARM64: `--version`, `serve`
- [ ] Verify binary sizes (should be ~40-50MB for GPU variants)
- [ ] Test vision API (if vision features enabled)
- [ ] Delete test release: `gh release delete v1.9.0-test --repo shimmy-private`

### Public Release (shimmy)
- [ ] All private tests passed
- [ ] Merge to main: `git push origin main`
- [ ] Create production tag: `git tag v1.9.0`
- [ ] Push tag: `git push origin v1.9.0`
- [ ] Wait for CI/CD build
- [ ] Verify release on GitHub: `gh release view v1.9.0`
- [ ] Update release notes with highlights
- [ ] Announce release (Reddit, Discord, Twitter, etc.)

---

## Quick Commands Reference

### Push to Private for Testing
```bash
git push private main              # Push main branch
git push private v1.9.0-test       # Push test tag
```

### Push to Public for Release
```bash
git push origin main               # Push main branch
git push origin v1.9.0             # Push release tag
```

### Download Private Binaries for Testing
```bash
gh release download v1.9.0-test --repo Michael-A-Kuykendall/shimmy-private
```

### Delete Failed Test Release
```bash
# Delete from private repo
gh release delete v1.9.0-test --yes --repo Michael-A-Kuykendall/shimmy-private
git push --delete private v1.9.0-test

# Clean local tag
git tag -d v1.9.0-test
```

### Check Release Status
```bash
# Private releases
gh release list --repo Michael-A-Kuykendall/shimmy-private

# Public releases
gh release list --repo Michael-A-Kuykendall/shimmy
```

---

## Benefits of This Workflow

### 1. **No Public Pollution**
Test releases stay in private repo. Public repo only has stable releases.

### 2. **Safe Experimentation**
Break things in private, fix before public release.

### 3. **Proper Validation**
Download and test actual binaries before users see them.

### 4. **Clean History**
Public repo has clean release history. No `-test`, `-rc`, `-alpha` noise.

### 5. **Security**
Private secrets (VISION_PRIVATE_TOKEN, etc.) stay in private repo actions.

---

## GitHub Actions Configuration

### Private Repo (shimmy-private)
`.github/workflows/release.yml`:
- Triggers on tags: `v*-test`, `v*-rc*`
- Uploads to private releases
- Uses private secrets for vision builds

### Public Repo (shimmy)
`.github/workflows/release.yml`:
- Triggers on tags: `v*` (excludes `-test`, `-rc`)
- Uploads to public releases
- Publishes to crates.io (optional)
- Announces to package managers

---

## Emergency Rollback

If public release has issues:

```bash
# Mark release as pre-release
gh release edit v1.9.0 --prerelease

# Or delete entirely
gh release delete v1.9.0 --yes
git push --delete origin v1.9.0
```

Then fix in private, re-validate, re-release.

---

## Example: Kitchen Sink Release

```bash
# 1. Local development
git checkout -b feat/kitchen-sink-arch
# ... implement changes ...
git commit -m "feat: Kitchen Sink 5-binary architecture"

# 2. Push to private for testing
git push private feat/kitchen-sink-arch
git tag v1.9.0-test
git push private v1.9.0-test

# 3. Wait for build, download binaries
gh release download v1.9.0-test --repo shimmy-private

# 4. Test locally
./shimmy-windows-x86_64.exe serve --gpu-backend auto
# (test GPU detection, vision API, etc.)

# 5. If tests pass, push to public
git checkout main
git merge feat/kitchen-sink-arch
git push origin main
git tag v1.9.0
git push origin v1.9.0

# 6. Cleanup private test
gh release delete v1.9.0-test --yes --repo shimmy-private
git push --delete private v1.9.0-test
```

---

## Notes

- Private repo CI/CD uses same workflows as public (just different triggers)
- Keep private repo synced with public: `git push private main` regularly
- Use private repo for breaking changes before announcing
- Public releases should always be tested first in private

This workflow prevents the "dangling test releases" problem permanently.
