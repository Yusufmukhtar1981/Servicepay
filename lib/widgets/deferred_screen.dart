import 'package:flutter/material.dart';

/// Load large, non-critical screen code only when that screen is requested.
class DeferredScreen extends StatefulWidget {
  const DeferredScreen({super.key, required this.load, required this.builder});
  final Future<void> Function() load;
  final Widget Function() builder;
  @override
  State<DeferredScreen> createState() => _DeferredScreenState();
}

class _DeferredScreenState extends State<DeferredScreen> {
  late Future<void> _ready = widget.load();
  @override
  Widget build(BuildContext context) => FutureBuilder<void>(
        future: _ready,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.done &&
              !snapshot.hasError) return widget.builder();
          return Scaffold(
            body: Center(
              child: snapshot.hasError
                  ? TextButton(
                      onPressed: () => setState(() => _ready = widget.load()),
                      child: const Text('Retry opening your account'),
                    )
                  : const CircularProgressIndicator(
                      semanticsLabel: 'Opening your account',
                    ),
            ),
          );
        },
      );
}
