"use client";

import { useState } from "react";
import MainLayout from "@/components/MainLayout";
import { useAuthStore } from "@/store";
import { FileText } from "lucide-react";

export default function KYCPage() {
  const { user } = useAuthStore();
  const [selectedType, setSelectedType] = useState("bvn");
  const [docNumber, setDocNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // KYC submission logic would go here
      setSuccess("KYC document submitted for verification");
      setDocNumber("");
      setFile(null);
    } catch (error) {
      console.error("KYC submission failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="max-w-2xl mx-auto">
        <div className="card-lg">
          <div className="flex items-center gap-3 mb-6">
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">KYC Verification</h1>
          </div>

          {/* KYC Status */}
          <div className="mb-6 rounded-lg bg-yellow-50 p-4 border border-yellow-200">
            <p className="font-medium text-yellow-900">Status: Pending</p>
            <p className="text-sm text-yellow-800 mt-1">
              Please complete KYC verification to unlock higher withdrawal limits
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="label">Document Type</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="input"
                disabled={loading}
              >
                <option value="bvn">BVN (Bank Verification Number)</option>
                <option value="nin">NIN (National Identification Number)</option>
              </select>
            </div>

            <div>
              <label className="label">
                {selectedType === "bvn" ? "BVN" : "NIN"}
              </label>
              <input
                type="text"
                value={docNumber}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "").slice(0, 11);
                  setDocNumber(value);
                }}
                placeholder={selectedType === "bvn" ? "12345678901" : "12345678901"}
                maxLength={11}
                className="input font-mono"
                disabled={loading}
              />
              <p className="mt-1 text-xs text-gray-500">
                Must be 11 digits
              </p>
            </div>

            <div>
              <label className="label">Supporting Document</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="hidden"
                  id="doc-upload"
                  disabled={loading}
                />
                <label
                  htmlFor="doc-upload"
                  className="flex flex-col items-center justify-center cursor-pointer"
                >
                  <FileText className="h-8 w-8 text-gray-400 mb-2" />
                  <span className="text-sm font-medium text-gray-900">
                    {file?.name || "Click to upload or drag and drop"}
                  </span>
                  <span className="text-xs text-gray-500">
                    PDF, JPG or PNG (up to 5MB)
                  </span>
                </label>
              </div>
            </div>

            {success && (
              <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800 border border-green-200">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !docNumber || !file}
              className="btn-primary w-full"
            >
              {loading ? "Submitting..." : "Submit for Verification"}
            </button>
          </form>
        </div>
      </div>
    </MainLayout>
  );
}
