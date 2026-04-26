/** @type {import('next').NextConfig} */
const nextConfig = {
  // Exclude ONNX runtime native binaries from the serverless bundle.
  // These are loaded dynamically at runtime, not bundled.
  serverExternalPackages: [
    'onnxruntime-node',
    '@huggingface/transformers',
    'sharp',
  ],
};

export default nextConfig;
