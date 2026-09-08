import 'package:flutter/foundation.dart';

class MarketplaceCartStore {
  MarketplaceCartStore._();

  static final ValueNotifier<List<Map<String, dynamic>>> items =
      ValueNotifier<List<Map<String, dynamic>>>([]);

  static int get count {
    return items.value.fold<int>(
      0,
      (sum, item) => sum + ((item['quantity'] as int?) ?? 1),
    );
  }

  static double get subtotal {
    return items.value.fold<double>(
      0,
      (sum, item) {
        final dynamic rawPrice = item['price'];
        final double price = rawPrice is num
            ? rawPrice.toDouble()
            : double.tryParse('$rawPrice') ?? 0;

        final int quantity = (item['quantity'] as int?) ?? 1;

        return sum + (price * quantity);
      },
    );
  }

  static void add(Map<String, dynamic> product) {
    final List<Map<String, dynamic>> current =
        List<Map<String, dynamic>>.from(items.value);

    final String id =
        '${product['_id'] ?? product['id'] ?? product['title'] ?? ''}';

    final int index = current.indexWhere(
      (item) => '${item['_id'] ?? item['id'] ?? item['title'] ?? ''}' == id,
    );

    if (index >= 0) {
      final Map<String, dynamic> updated =
          Map<String, dynamic>.from(current[index]);

      updated['quantity'] = ((updated['quantity'] as int?) ?? 1) + 1;

      current[index] = updated;
    } else {
      final Map<String, dynamic> newItem = Map<String, dynamic>.from(product);

      newItem['quantity'] = 1;
      current.add(newItem);
    }

    items.value = current;
  }

  static void increase(int index) {
    if (index < 0 || index >= items.value.length) {
      return;
    }

    final List<Map<String, dynamic>> current =
        List<Map<String, dynamic>>.from(items.value);

    final Map<String, dynamic> updated =
        Map<String, dynamic>.from(current[index]);

    updated['quantity'] = ((updated['quantity'] as int?) ?? 1) + 1;

    current[index] = updated;
    items.value = current;
  }

  static void decrease(int index) {
    if (index < 0 || index >= items.value.length) {
      return;
    }

    final List<Map<String, dynamic>> current =
        List<Map<String, dynamic>>.from(items.value);

    final Map<String, dynamic> updated =
        Map<String, dynamic>.from(current[index]);

    final int quantity = (updated['quantity'] as int?) ?? 1;

    if (quantity <= 1) {
      current.removeAt(index);
    } else {
      updated['quantity'] = quantity - 1;
      current[index] = updated;
    }

    items.value = current;
  }

  static void remove(int index) {
    if (index < 0 || index >= items.value.length) {
      return;
    }

    final List<Map<String, dynamic>> current =
        List<Map<String, dynamic>>.from(items.value);

    current.removeAt(index);
    items.value = current;
  }

  static void clear() {
    items.value = <Map<String, dynamic>>[];
  }
}
