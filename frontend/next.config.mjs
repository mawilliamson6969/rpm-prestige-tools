/** @type {import('next').NextConfig} */
// `standalone` tells Next to emit a self-contained server tree for Docker (smaller runtime image).
const nextConfig = {
  output: "standalone",
};

export default nextConfig;
