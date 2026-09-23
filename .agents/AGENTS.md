# Workspace Customization Rules

- **Quantized LLM Requirement**: For local SSMI architecture, always use 4-bit quantized versions (GGUF Q4_K_M or AWQ/GPTQ) of models such as Qwen2.5-14B. This reduces disk and VRAM overhead from ~28 GB to ~9 GB, speeds up load and generation times, and maintains >98% accuracy.
