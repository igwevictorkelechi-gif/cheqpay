import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform } from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';

/**
 * Date of birth entry backed by the platform's calendar picker.
 *
 * Replaces a plain text box that asked people to type "YYYY-MM-DD" by hand.
 * That format is not what any Nigerian user writes by default, and a value the
 * server cannot parse is silently dropped — the field looked filled in and the
 * date never arrived, which is one reason enrollment kept being skipped.
 *
 * The two platforms want opposite things, so they are handled separately
 * rather than pretending one interaction fits both:
 *  - Android shows a modal dialog that dismisses itself, so committing on the
 *    change event is correct.
 *  - iOS renders inline and emits an event for every scroll tick, so it goes in
 *    a sheet with an explicit Done button and only commits when tapped.
 */

/** Nobody using a bank app was born after today or before 1906. */
const MAX_DATE = new Date();
const MIN_DATE = new Date(new Date().getFullYear() - 120, 0, 1);

/** Date -> "YYYY-MM-DD", the format the API expects. Local, not UTC: toISOString
 *  shifts by the timezone offset and can hand back the previous day. */
function toIso(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "YYYY-MM-DD" -> Date, or a sensible starting point when unset. */
function fromIso(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Opening on today means ~30 scrolls to reach a plausible birth year, so
  // start the wheel somewhere an adult actually is.
  const d = new Date();
  d.setFullYear(d.getFullYear() - 25);
  return d;
}

/** "1998-04-23" -> "23 April 1998". */
function humanize(value: string): string {
  const d = fromIso(value);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function DateField({
  label,
  value,
  onChange,
  placeholder = 'Select your date of birth',
  hint,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  // iOS edits a draft so a cancelled sheet leaves the value untouched.
  const [draft, setDraft] = useState<Date>(() => fromIso(value));

  const openPicker = () => {
    setDraft(fromIso(value));
    setOpen(true);
  };

  const onAndroidChange = (event: DateTimePickerEvent, picked?: Date) => {
    setOpen(false);
    if (event.type === 'set' && picked) onChange(toIso(picked));
  };

  return (
    <View>
      <Text className="text-muted dark:text-muted-dark text-sm font-semibold mb-1.5">
        {label}
      </Text>

      <TouchableOpacity
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${humanize(value)}` : label}
        className="rounded-2xl px-4 py-3.5 flex-row items-center justify-between"
        style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
      >
        <Text
          className="text-base"
          style={{ color: value ? colors.ink : colors.muted }}
        >
          {value ? humanize(value) : placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={20} color={colors.muted} />
      </TouchableOpacity>

      {hint ? (
        <Text className="text-muted dark:text-muted-dark text-xs mt-1.5">{hint}</Text>
      ) : null}

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={draft}
          mode="date"
          display="calendar"
          maximumDate={MAX_DATE}
          minimumDate={MIN_DATE}
          onChange={onAndroidChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="slide">
          <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <View
              style={{ backgroundColor: colors.surfaceSoft }}
              className="rounded-t-3xl pb-8"
            >
              <View
                className="flex-row items-center justify-between px-5 py-4"
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                <TouchableOpacity onPress={() => setOpen(false)}>
                  <Text className="text-base" style={{ color: colors.muted }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <Text className="text-ink dark:text-ink-dark text-base font-bold">
                  {label}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    onChange(toIso(draft));
                    setOpen(false);
                  }}
                >
                  <Text className="text-base font-bold" style={{ color: colors.brandLight }}>
                    Done
                  </Text>
                </TouchableOpacity>
              </View>

              <DateTimePicker
                value={draft}
                mode="date"
                display="spinner"
                maximumDate={MAX_DATE}
                minimumDate={MIN_DATE}
                themeVariant="dark"
                onChange={(_e, picked) => picked && setDraft(picked)}
                style={{ height: 216 }}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
