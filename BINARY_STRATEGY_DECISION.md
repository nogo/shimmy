# Binary Strategy Decision: CPU-only vs GPU-auto

## TL;DR Recommendation

**Build 8 binaries**: CPU-only + GPU-auto (all GPU backends in one) per platform

Instead of:
- ❌ `shimmy-windows-vulkan.exe` + `shimmy-windows-cuda.exe` (user picks backend)

Do this:
- ✅ `shimmy-windows-cpu.exe` + `shimmy-windows-gpu.exe` (cuda+vulkan+opencl all in one)

**Reasoning**: Your users are failing at compilation, not failing at choosing between Vulkan and CUDA.

---

## What You GAIN

### 1. **Solves Real User Pain**
From actual issues:
- **#129**: "GPU support not available in precompiled" → SOLVED (gpu binary has it all)
- **#130**: "Built with vulkan but GPU not used" → SOLVED (auto-detection in binary)
- **#142**: "AMD GPU ignored" → SOLVED (gpu binary has opencl+vulkan, auto-picks)
- **#110, #105, #99, #86**: Compilation failures → SOLVED (no compilation needed)
- **#144**: "MLX should be default on Apple Silicon" → SOLVED (gpu binary for ARM64 Mac)

### 2. **Simpler Download Page**
**Before** (your current plan):
```
Linux x86_64:
  - shimmy-linux-x86_64-cpu (for servers)
  - shimmy-linux-x86_64-cuda (for NVIDIA GPUs)
  
Windows x64:
  - shimmy-windows-x86_64-cpu.exe (for servers)
  - shimmy-windows-x86_64-vulkan.exe (for AMD/NVIDIA/Intel GPUs)
```
User asks: "I have NVIDIA, do I use cuda or vulkan?"

**After** (Option C):
```
Linux x86_64:
  - shimmy-linux-x86_64-cpu (servers, VMs, no GPU)
  - shimmy-linux-x86_64-gpu (workstations with any GPU)
  
Windows x64:
  - shimmy-windows-x86_64-cpu.exe (servers, VMs, no GPU)  
  - shimmy-windows-x86_64-gpu.exe (workstations with any GPU)
```
User asks: "Do I have a GPU?" → Yes? Download gpu. No? Download cpu.

### 3. **Future-Proof**
New GPU backend added to llama.cpp? Already in the gpu binary. User doesn't re-download.

### 4. **Fewer Support Issues**
Current plan requires you to answer:
- "Which GPU backend should I use?"
- "I have NVIDIA, why isn't CUDA working in the Vulkan binary?"
- "Can I use the CUDA binary on AMD?" (No)

GPU-auto plan: "Download the gpu binary, it detects your hardware."

---

## What You LOSE

### 1. **Larger Download Size**
- CPU binary: ~15-20 MB
- GPU binary: ~40-50 MB (all backends compiled in)
- User with NVIDIA downloads 50MB, only uses CUDA portion (~20MB of it)

**Counter-argument**: 
- Most users have 100+ Mbps internet (50MB = 4 seconds)
- Ollama is 600MB+, users don't complain
- 30MB "waste" < 2 hours debugging feature flags

### 2. **Longer CI/CD Build Times**
- Current plan: 9 builds (some parallel)
- GPU-auto: 8 builds, but each GPU build takes longer (compiling 3 backends)
- Estimate: +15-20 minutes per release

**Counter-argument**:
- You release once per week/month
- 20 minutes of CI time < hours of support issues

### 3. **Binary Complexity**
Multiple GPU backends in one binary = more code paths = more potential bugs

**Counter-argument**:
- llama.cpp already handles this with `--gpu-backend auto`
- Runtime detection is battle-tested (Ollama does this)
- Issues would surface in testing, not production

### 4. **Less Explicit Control**
Power user with CUDA wants CUDA-only binary (smaller, faster startup)

**Counter-argument**:
- Power users can still compile from source
- 99% of users want "just works" > "perfect optimization"
- Can always add specialized binaries later based on feedback

---

## Devil's Advocate: Arguments AGAINST GPU-auto

### Argument 1: "Users should know their hardware"
**Claim**: If user has NVIDIA, they should download CUDA binary. Education > hand-holding.

**Rebuttal**: Your issues show users DON'T know:
- Issue #142: User tried OpenCL on AMD (correct!) but it didn't work
- Issue #130: User tried Vulkan (correct!) but it didn't work
- Root cause: Not binary choice, but llama.cpp configuration bugs

Your job: Fix the tool, not educate users on GPU architectures.

### Argument 2: "Bigger binaries are wasteful"
**Claim**: 50MB with 3 backends when user only needs 1 is bloat.

**Rebuttal**: 
- NPM packages: 200MB+ for simple web apps (nobody complains)
- Ollama: 600MB (users love it)
- Docker images: Multi-GB (standard practice)
- Shimmy gpu binary: 50MB (smaller than Chrome installer)

Context matters: Shimmy is infrastructure software, not a mobile app.

### Argument 3: "Compilation is fine, users should learn Rust"
**Claim**: Real developers compile from source. Pre-built binaries are for noobs.

**Rebuttal**: Your issues prove this is gatekeeping:
- Issue #110: macOS user, compilation failed (missing files)
- Issue #105: Windows user with VS2022, compilation failed (template errors)  
- Issue #99: Generic failure (user gave up)

These aren't "unskilled users" - they're developers with C++ toolchains who still failed.

### Argument 4: "We can document the choice better"
**Claim**: Better docs solve the "which binary?" question.

**Rebuttal**:
```markdown
# Download Guide
- NVIDIA GPU → cuda binary
- AMD GPU → vulkan or opencl binary
- Intel GPU → vulkan binary  
- Apple Silicon → mlx binary
- No GPU → cpu binary
- Hybrid (NVIDIA + Intel) → ??? (both? which is primary?)
```

Now compare:
```markdown
# Download Guide
- Have GPU? → gpu binary
- No GPU? → cpu binary
```

Which docs will users actually read?

### Argument 5: "This is premature optimization"
**Claim**: Wait for more user feedback before consolidating binaries.

**Rebuttal**: You have 22+ issues about builds. The feedback is IN. Common themes:
1. Compilation fails → Need pre-built binaries
2. Pre-built is CPU-only → Need GPU binaries
3. Don't know which features → Need simpler choice

You're not predicting future needs, you're solving current pain.

---

## What Actually Changes (Code/Docs)

### Changes in `.github/workflows/release.yml`
```diff
- # Windows - Vulkan GPU
- artifact-name: shimmy-windows-x86_64-vulkan.exe
- features: huggingface,llama,llama-vulkan,vision

+ # Windows - GPU (all backends)
+ artifact-name: shimmy-windows-x86_64-gpu.exe
+ features: huggingface,llama,llama-cuda,llama-vulkan,llama-opencl,vision
```

Same for Linux x64, macOS ARM64.

### Changes in `README.md`
**Before**:
```markdown
## Download

Choose the right binary for your system:
- Linux x86_64 CPU: `shimmy-linux-x86_64-cpu`
- Linux x86_64 CUDA (NVIDIA): `shimmy-linux-x86_64-cuda`
- Windows CPU: `shimmy-windows-x86_64-cpu.exe`
- Windows Vulkan (AMD/NVIDIA/Intel): `shimmy-windows-x86_64-vulkan.exe`
...
```

**After**:
```markdown
## Download

**Do you have a GPU?**
- ✅ Yes → Download the `-gpu` binary for your platform
- ❌ No → Download the `-cpu` binary

Platform-specific:
- Linux x86_64: `shimmy-linux-x86_64-gpu` or `shimmy-linux-x86_64-cpu`
- Windows: `shimmy-windows-x86_64-gpu.exe` or `shimmy-windows-x86_64-cpu.exe`
- macOS ARM64: `shimmy-macos-arm64-gpu` or `shimmy-macos-arm64-cpu`
...
```

### Changes in Wiki
New page: "GPU Support FAQ"
```markdown
Q: I have NVIDIA, should I use CUDA or Vulkan?
A: Use the `-gpu` binary. It includes both and auto-detects.

Q: I have AMD, should I use OpenCL or Vulkan?
A: Use the `-gpu` binary. It includes both and auto-detects.

Q: The binary is 50MB, that seems large?
A: It includes multiple GPU backends for compatibility. 
   If size matters (embedded systems), use the `-cpu` binary.

Q: Can I force a specific backend?
A: Yes: `shimmy serve --gpu-backend cuda` or `--gpu-backend vulkan`
```

### No Changes Needed
- CLI interface (same commands)
- API endpoints (same)
- Model compatibility (same)
- Configuration files (same)
- Docker setup (same)

---

## Comparison Matrix

| Aspect | Current Plan (9 binaries) | GPU-auto (8 binaries) |
|--------|---------------------------|----------------------|
| **User choice complexity** | Medium (pick backend) | Low (CPU or GPU?) |
| **Download size** | Smaller (20-25MB) | Larger (40-50MB) |
| **Solves compilation issues** | ✅ Yes | ✅ Yes |
| **Solves GPU detection issues** | ⚠️ Partial (if right binary) | ✅ Yes (auto-detect) |
| **Covers all GPU types** | ⚠️ No (e.g., no OpenCL on Windows plan) | ✅ Yes |
| **CI/CD complexity** | Medium | Medium |
| **CI/CD build time** | ~30 min | ~45 min (+15 min) |
| **Maintenance burden** | Medium (9 variants) | Medium (8 variants) |
| **Documentation effort** | High (explain backends) | Low (explain CPU vs GPU) |
| **Support tickets expected** | Medium (backend questions) | Low (simple choice) |
| **Power user satisfaction** | High (granular choice) | Medium (one-size-fits-all) |
| **Casual user satisfaction** | Low (confused) | High (just works) |

---

## The Real Question

**Who are you optimizing for?**

### Current plan optimizes for:
- Power users who know their GPU architecture
- Minimal download size
- Explicit control

### GPU-auto optimizes for:
- 95% of users who just want it to work
- Zero compilation
- Fewer support issues

**Based on your issues**: 22+ build problems, 0 "I wish I had a CUDA-only binary" requests.

Your users are telling you: "I don't care about backend choice, I just want GPU to work."

---

## Migration Path (If You Change Your Mind)

**Scenario**: You ship GPU-auto, users complain it's too large.

**Solution**: Add specialized binaries in v1.9.0:
```
shimmy-windows-x86_64-cpu.exe      (existing)
shimmy-windows-x86_64-gpu.exe      (existing, all backends)
shimmy-windows-x86_64-cuda.exe     (NEW, NVIDIA-only, smaller)
shimmy-windows-x86_64-vulkan.exe   (NEW, cross-GPU, smaller)
```

Users who want smaller download can opt into specialized. Default stays "gpu-auto".

**Scenario 2**: You ship backend-specific, users confused.

**Solution**: Consolidate in v1.9.0:
```
[DEPRECATED] shimmy-windows-x86_64-cuda.exe
[DEPRECATED] shimmy-windows-x86_64-vulkan.exe
[RECOMMENDED] shimmy-windows-x86_64-gpu.exe
```

Harder migration (breaking change for existing users).

**Recommendation**: Start simple (gpu-auto), add complexity later if needed. Easier than starting complex and simplifying.

---

## Final Recommendation

**Ship GPU-auto (Option C)** because:

1. **Solves real pain**: 22 issues about builds, 0 about wanting backend-specific binaries
2. **Simpler UX**: "Do you have a GPU?" vs "What GPU backend does your hardware need?"
3. **Future-proof**: New GPU backend? Already included.
4. **Reversible**: Can always add specialized binaries later based on feedback
5. **Aligned with industry**: Ollama, llama.cpp, etc. all do auto-detection

**Trade-off accepted**: 30MB extra download for zero user confusion.

---

## Questions to Decide This

1. **What % of your users have GPU?**
   - If <20%: Maybe backend-specific is fine (niche use case)
   - If >50%: Definitely gpu-auto (mainstream feature)
   - Your issues suggest: >70% (lots of GPU complaints)

2. **What's your support capacity?**
   - High capacity: Can answer "which backend?" questions
   - Low capacity: Ship gpu-auto, reduce tickets

3. **What's your brand?**
   - "Power user tool": Backend-specific binaries fit
   - "Ollama alternative (simpler)": GPU-auto fits
   - Your tagline: "Lightweight Ollama alternative" → Suggests simplicity

4. **How often do you release?**
   - Weekly: +15min CI time = minor annoyance
   - Monthly: +15min CI time = irrelevant
   - Quarterly: +15min CI time = who cares

**My read of your project**: You want "Ollama but faster/smaller". Ollama ships one binary per platform with auto-detect. You should too.

---

## Next Steps If You Agree

1. Revert current commit (cea38685)
2. Update release.yml with GPU-auto feature flags
3. Update README with simple cpu/gpu choice
4. Ship v1.8.2 with 8 binaries
5. Monitor issues - if users want specialized, add in v1.9.0

**Risk**: Low. Worst case, you add specialized binaries later.  
**Reward**: High. Solve 22+ issues, reduce future support burden.
