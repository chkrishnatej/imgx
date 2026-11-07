class Imgx < Formula
  desc "Convert images between common formats from the command-line"
  homepage "https://github.com/chkrishnatej/imgx"
  license "MIT"

  # Only the HEAD build compiles from source, so Bun is only needed there.
  head do
    url "https://github.com/chkrishnatej/imgx.git", branch: "main"
    depends_on "bun"
  end

  # The stable build downloads the release archives. Their checksums are
  # filled in by scripts/update-formula.sh once a release is published.
  on_macos do
    on_arm do
      url "https://github.com/chkrishnatej/imgx/releases/download/v0.0.0/imgx-0.0.0-darwin-arm64.tar.gz"
      sha256 "REPLACE_DARWIN_ARM64_SHA"
    end

    on_intel do
      url "https://github.com/chkrishnatej/imgx/releases/download/v0.0.0/imgx-0.0.0-darwin-x64.tar.gz"
      sha256 "REPLACE_DARWIN_X64_SHA"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/chkrishnatej/imgx/releases/download/v0.0.0/imgx-0.0.0-linux-arm64.tar.gz"
      sha256 "REPLACE_LINUX_ARM64_SHA"
    end

    on_intel do
      url "https://github.com/chkrishnatej/imgx/releases/download/v0.0.0/imgx-0.0.0-linux-x64.tar.gz"
      sha256 "REPLACE_LINUX_X64_SHA"
    end
  end

  def install
    if build.head?
      # HEAD has no release archive, so it is compiled from source instead.
      system "bun", "install", "--frozen-lockfile", "--production"
      system "bun", "build", "--compile", "--outfile", "imgx", "src/cli.ts"
      bin.install "imgx"
      man1.install "man/imgx.1"
      zsh_completion.install "completions/_imgx"
    else
      bin.install "bin/imgx"
      man1.install "share/man/man1/imgx.1"
      zsh_completion.install "share/zsh/site-functions/_imgx"
    end
  end

  def caveats
    <<~EOS
      The heic, heif, psd, pdf and camera raw inputs are decoded through macOS
      sips and are therefore unavailable on Linux.
    EOS
  end

  test do
    assert_match(/\d+\.\d+\.\d+|HEAD/, shell_output("#{bin}/imgx --version"))

    svg = testpath/"diagram.svg"
    svg.write <<~SVG
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
        <rect width="100" height="50" fill="red"/>
      </svg>
    SVG

    assert_match "100x50", shell_output("#{bin}/imgx #{svg} -o #{testpath}/out.png")
    assert_path_exists testpath/"out.png"
  end
end
