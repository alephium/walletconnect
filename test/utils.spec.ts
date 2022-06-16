import "mocha";
import { expect } from "chai";

import { 
  formatChain,
  isCompatibleChainGroup,
  parseChain,
} from "../src/index";

const networkId = 4;
const expectedChainGroup0 = 2;
const expectedChainGroup1 = undefined;

describe("Utility functions", () => {
  describe("formatChain", () => {
    it("formats chainId to -1 when undefined is passed", () => {
      expect(formatChain(networkId, expectedChainGroup1)).to.eql("alephium:4/-1");
    });

    it("formats the chain string given a network id and chain id", () => {
      expect(formatChain(networkId, expectedChainGroup0)).to.eql("alephium:4/2");
    });
  })

  describe("isCompatibleChainGroup", () => {
    it("compares two equal chains", () => {
      expect(isCompatibleChainGroup(2, expectedChainGroup0)).to.eql(true);
    });

    it("compares two inequal chains", () => {
      expect(isCompatibleChainGroup(1, expectedChainGroup0)).to.eql(false);
    });

    it("compares 'any chain' -1 with any other chain", () => {
      expect(isCompatibleChainGroup(2, expectedChainGroup1)).to.eql(true);
      expect(isCompatibleChainGroup(1, expectedChainGroup1)).to.eql(true);
    });
  });

  describe("parseChain", () => {
    it("parses the chain into two integers", () => {
      expect(parseChain("alephium:4/2")).to.eql([4, 2]);
    });

    it("parses the 'any chain' -1 into undefined", () => {
      expect(parseChain("alephium:4/-1")).to.eql([4, undefined]);
    });
  });
});
