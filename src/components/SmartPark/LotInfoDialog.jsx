import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const EMPTY = { name: "", address: "", latitude: "", longitude: "" };

export default function LotInfoDialog({ open, onOpenChange, initial, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm({
        name: initial?.name || "",
        address: initial?.address || "",
        latitude: initial?.latitude ?? "",
        longitude: initial?.longitude ?? "",
      });
      setError("");
    }
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!form.address.trim()) {
      setError("Enter the lot address.");
      return;
    }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), address: form.address.trim() };
      if (form.latitude !== "" && form.longitude !== "") {
        payload.latitude = Number(form.latitude);
        payload.longitude = Number(form.longitude);
      }
      const saved = initial?.id
        ? await base44.entities.LotInfo.update(initial.id, payload)
        : await base44.entities.LotInfo.create(payload);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || "Could not save the address.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lot location</DialogTitle>
          <DialogDescription>
            Drivers scan the QR code and get turn-by-turn directions here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lot-name">Lot name</Label>
            <Input id="lot-name" value={form.name} onChange={set("name")} placeholder="Main Street Garage" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lot-address">Address</Label>
            <Input id="lot-address" value={form.address} onChange={set("address")} placeholder="123 Main St, Detroit, MI" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lot-lat">Latitude (optional)</Label>
              <Input id="lot-lat" value={form.latitude} onChange={set("latitude")} placeholder="42.331" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lot-lng">Longitude (optional)</Label>
              <Input id="lot-lng" value={form.longitude} onChange={set("longitude")} placeholder="-83.045" inputMode="decimal" />
            </div>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}